// app/api/dashboard/applications/add/route.js
import { NextResponse } from 'next/server';
import { getClient } from '@backend/dbConnect';
import {
  captureException,
  captureMessage,
  captureDatabaseError,
} from '@/monitoring/sentry';
import {
  categorizeError,
  generateRequestId,
  extractRealIp,
  anonymizeIp,
} from '@/utils/helpers';
import logger from '@/utils/logger';
import isAuthenticatedUser from '@backend/authMiddleware';
import { applyRateLimit } from '@backend/rateLimiter';
import { sanitizeApplicationInputsStrict } from '@/utils/sanitizers/sanitizeApplicationInputs';
import { applicationAddingSchema } from '@/utils/schemas/applicationSchema';
// AJOUT POUR L'INVALIDATION DU CACHE
import { dashboardCache, getDashboardCacheKey } from '@/utils/cache';

// ----- CONFIGURATION DU RATE LIMITING POUR L'AJOUT D'APPLICATIONS -----

// Créer le middleware de rate limiting spécifique pour l'ajout d'applications
const addApplicationRateLimit = applyRateLimit('CONTENT_API', {
  // Configuration personnalisée pour l'ajout d'applications
  windowMs: 5 * 60 * 1000, // 5 minutes (plus strict pour les mutations)
  max: 8, // 8 ajouts par 5 minutes (plus restrictif que templates car plus complexe)
  message:
    "Trop de tentatives d'ajout d'applications. Veuillez réessayer dans quelques minutes.",
  skipSuccessfulRequests: false, // Compter tous les ajouts réussis
  skipFailedRequests: false, // Compter aussi les échecs
  prefix: 'add_application', // Préfixe spécifique pour l'ajout d'applications

  // Fonction personnalisée pour générer la clé (basée sur IP)
  keyGenerator: (req) => {
    const ip = extractRealIp(req);
    return `add_application:ip:${ip}`;
  },
});

// ----- FONCTION D'INVALIDATION DU CACHE -----
const invalidateApplicationsCache = (requestId) => {
  try {
    const cacheKey = getDashboardCacheKey('applications_list', {
      endpoint: 'dashboard_applications',
      version: '1.0',
    });

    const cacheInvalidated = dashboardCache.applications.delete(cacheKey);

    logger.debug('Applications cache invalidation', {
      requestId,
      component: 'applications',
      action: 'cache_invalidation',
      operation: 'add_application',
      cacheKey,
      invalidated: cacheInvalidated,
    });

    // Capturer l'invalidation du cache avec Sentry
    captureMessage('Applications cache invalidated after addition', {
      level: 'info',
      tags: {
        component: 'applications',
        action: 'cache_invalidation',
        entity: 'application',
        operation: 'create',
      },
      extra: {
        requestId,
        cacheKey,
        invalidated: cacheInvalidated,
      },
    });

    return cacheInvalidated;
  } catch (cacheError) {
    logger.warn('Failed to invalidate applications cache', {
      requestId,
      component: 'applications',
      action: 'cache_invalidation_failed',
      operation: 'add_application',
      error: cacheError.message,
    });

    captureException(cacheError, {
      level: 'warning',
      tags: {
        component: 'applications',
        action: 'cache_invalidation_failed',
        error_category: 'cache',
        entity: 'application',
        operation: 'create',
      },
      extra: {
        requestId,
      },
    });

    return false;
  }
};

// ----- FONCTION POUR CRÉER LES HEADERS DE RÉPONSE -----
const createResponseHeaders = (
  requestId,
  responseTime,
  rateLimitInfo = null,
) => {
  const headers = {
    // ===== HEADERS COMMUNS (sécurité de base) =====
    'Access-Control-Allow-Origin':
      process.env.NEXT_PUBLIC_SITE_URL || 'same-origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-Requested-With',

    // Anti-cache strict pour les mutations
    'Cache-Control':
      'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',

    // Sécurité de base
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',

    // Isolation moderne
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless',
    'Cross-Origin-Resource-Policy': 'same-site',

    // Sécurité pour mutations de données
    'Referrer-Policy': 'strict-origin-when-cross-origin',

    // CSP pour manipulation de données
    'Content-Security-Policy': "default-src 'none'; connect-src 'self'",

    // ===== HEADERS SPÉCIFIQUES À L'AJOUT D'APPLICATIONS =====
    // Rate limiting spécifique aux applications (8 au lieu de 10)
    'X-RateLimit-Window': '300', // 5 minutes en secondes
    'X-RateLimit-Limit': '8',

    // Validation métier applications
    'X-Resource-Validation': 'application-data',
    'X-Template-Validation': 'template-id-required',
    'X-Media-Management': 'multiple-images',
    'X-Business-Rules': 'fee-rent-validation',

    // Cache et base de données
    'X-Cache-Invalidation': 'applications',
    'X-Database-Operations': '2', // connection + insert

    // Headers de traçabilité
    'X-Request-ID': requestId,
    'X-Response-Time': `${responseTime}ms`,
    'X-API-Version': '1.0',
    'X-Transaction-Type': 'mutation',
    'X-Entity-Type': 'application',
    'X-Operation-Type': 'create',

    // Headers de validation
    'X-Sanitization-Applied': 'true',
    'X-Yup-Validation-Applied': 'true',

    // Headers de performance et traçabilité
    Vary: 'Authorization, Content-Type',
    'X-Permitted-Cross-Domain-Policies': 'none',
  };

  // Ajouter les infos de rate limiting si disponibles
  if (rateLimitInfo) {
    headers['X-RateLimit-Remaining'] =
      rateLimitInfo.remaining?.toString() || '0';
    headers['X-RateLimit-Reset'] = rateLimitInfo.resetTime?.toString() || '0';
  }

  return headers;
};

// ----- API ROUTE PRINCIPALE AVEC RATE LIMITING -----

export async function POST(request) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();

  logger.info('Add Application API called', {
    timestamp: new Date().toISOString(),
    requestId,
    component: 'applications',
    action: 'api_start',
    method: 'POST',
    operation: 'add_application',
  });

  // Capturer le début du processus d'ajout d'application
  captureMessage('Add application process started', {
    level: 'info',
    tags: {
      component: 'applications',
      action: 'process_start',
      api_endpoint: '/api/dashboard/applications/add',
      entity: 'application',
      operation: 'create',
    },
    extra: {
      requestId,
      timestamp: new Date().toISOString(),
      method: 'POST',
    },
  });

  try {
    // ===== ÉTAPE 1: APPLIQUER LE RATE LIMITING =====
    logger.debug('Applying rate limiting for add application API', {
      requestId,
      component: 'applications',
      action: 'rate_limit_start',
      operation: 'add_application',
    });

    const rateLimitResponse = await addApplicationRateLimit(request);

    // Si le rate limiter retourne une réponse, cela signifie que la limite est dépassée
    if (rateLimitResponse) {
      logger.warn('Add application API rate limit exceeded', {
        requestId,
        component: 'applications',
        action: 'rate_limit_exceeded',
        operation: 'add_application',
        ip: anonymizeIp(extractRealIp(request)),
      });

      // Capturer l'événement de rate limiting avec Sentry
      captureMessage('Add application API rate limit exceeded', {
        level: 'warning',
        tags: {
          component: 'applications',
          action: 'rate_limit_exceeded',
          error_category: 'rate_limiting',
          entity: 'application',
          operation: 'create',
        },
        extra: {
          requestId,
          ip: anonymizeIp(extractRealIp(request)),
          userAgent:
            request.headers.get('user-agent')?.substring(0, 100) || 'unknown',
        },
      });

      // Ajouter les headers de sécurité même en cas de rate limit
      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(requestId, responseTime, {
        remaining: 0,
      });

      // Modifier la réponse pour inclure nos headers
      const rateLimitBody = await rateLimitResponse.json();
      return NextResponse.json(rateLimitBody, {
        status: 429,
        headers: headers,
      });
    }

    logger.debug('Rate limiting passed successfully', {
      requestId,
      component: 'applications',
      action: 'rate_limit_passed',
      operation: 'add_application',
    });

    // ===== ÉTAPE 2: VÉRIFICATION AUTHENTIFICATION =====
    logger.debug('Verifying user authentication', {
      requestId,
      component: 'applications',
      action: 'auth_verification_start',
      operation: 'add_application',
    });

    await isAuthenticatedUser(request, NextResponse);

    logger.debug('User authentication verified successfully', {
      requestId,
      component: 'applications',
      action: 'auth_verification_success',
      operation: 'add_application',
    });

    // ===== ÉTAPE 3: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
      logger.debug('Database connection successful', {
        requestId,
        component: 'applications',
        action: 'db_connection_success',
        operation: 'add_application',
      });
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Database Connection Error during application addition', {
        category: errorCategory,
        message: dbConnectionError.message,
        timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
        requestId,
        component: 'applications',
        action: 'db_connection_failed',
        operation: 'add_application',
      });

      // Capturer l'erreur de connexion DB avec Sentry
      captureDatabaseError(dbConnectionError, {
        tags: {
          component: 'applications',
          action: 'db_connection_failed',
          operation: 'connection',
          entity: 'application',
        },
        extra: {
          requestId,
          timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
          ip: anonymizeIp(extractRealIp(request)),
          rateLimitingApplied: true,
        },
      });

      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(requestId, responseTime);

      return NextResponse.json(
        { error: 'Database connection failed' },
        { status: 503, headers },
      );
    }

    // ===== ÉTAPE 4: PARSING ET VALIDATION DU BODY =====
    let body;
    try {
      body = await request.json();
      logger.debug('Request body parsed successfully', {
        requestId,
        component: 'applications',
        action: 'body_parse_success',
        operation: 'add_application',
      });
    } catch (parseError) {
      const errorCategory = categorizeError(parseError);

      logger.error('JSON Parse Error during application addition', {
        category: errorCategory,
        message: parseError.message,
        requestId,
        component: 'applications',
        action: 'json_parse_error',
        operation: 'add_application',
        headers: {
          'content-type': request.headers.get('content-type'),
          'user-agent': request.headers.get('user-agent')?.substring(0, 100),
        },
      });

      // Capturer l'erreur de parsing avec Sentry
      captureException(parseError, {
        level: 'error',
        tags: {
          component: 'applications',
          action: 'json_parse_error',
          error_category: categorizeError(parseError),
          operation: 'create',
        },
        extra: {
          requestId,
          contentType: request.headers.get('content-type'),
          userAgent: request.headers.get('user-agent')?.substring(0, 100),
        },
      });

      if (client) await client.cleanup();

      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(requestId, responseTime);

      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400, headers },
      );
    }

    const {
      name,
      link,
      admin,
      description,
      category,
      fee,
      rent,
      imageUrls,
      templateId,
      level,
    } = body;

    logger.debug('Application data extracted from request', {
      requestId,
      component: 'applications',
      action: 'data_extraction',
      operation: 'add_application',
      hasName: !!name,
      hasLink: !!link,
      hasAdmin: !!admin,
      hasImages: !!imageUrls,
      imageCount: Array.isArray(imageUrls) ? imageUrls.length : 0,
    });

    // ===== ÉTAPE 5: SANITIZATION DES INPUTS =====
    logger.debug('Sanitizing application inputs', {
      requestId,
      component: 'applications',
      action: 'input_sanitization',
      operation: 'add_application',
    });

    const sanitizedInputs = sanitizeApplicationInputsStrict({
      name,
      link,
      admin,
      description,
      category,
      fee,
      rent,
      imageUrls,
      templateId,
      level,
    });

    // Utiliser les données sanitizées pour la suite du processus
    const {
      name: sanitizedName,
      link: sanitizedLink,
      admin: sanitizedAdmin,
      description: sanitizedDescription,
      category: sanitizedCategory,
      fee: sanitizedFee,
      rent: sanitizedRent,
      imageUrls: sanitizedImageUrls,
      templateId: sanitizedTemplateId,
      level: sanitizedLevel,
    } = sanitizedInputs;

    logger.debug('Input sanitization completed', {
      requestId,
      component: 'applications',
      action: 'input_sanitization_completed',
      operation: 'add_application',
    });

    // ===== ÉTAPE 6: VALIDATION AVEC YUP =====
    try {
      // Valider les données sanitizées avec le schema Yup
      await applicationAddingSchema.validate(
        {
          name: sanitizedName,
          link: sanitizedLink,
          admin: sanitizedAdmin,
          description: sanitizedDescription,
          category: sanitizedCategory,
          fee: sanitizedFee,
          rent: sanitizedRent,
          imageUrls: sanitizedImageUrls,
          templateId: sanitizedTemplateId,
          level: sanitizedLevel,
        },
        { abortEarly: false },
      );

      logger.debug('Application validation with Yup passed', {
        requestId,
        component: 'applications',
        action: 'yup_validation_success',
        operation: 'add_application',
      });
    } catch (validationError) {
      const errorCategory = categorizeError(validationError);

      logger.error('Application Validation Error with Yup', {
        category: errorCategory,
        failed_fields: validationError.inner?.map((err) => err.path) || [],
        total_errors: validationError.inner?.length || 0,
        requestId,
        component: 'applications',
        action: 'yup_validation_failed',
        operation: 'add_application',
      });

      // Capturer l'erreur de validation avec Sentry
      captureMessage('Application validation failed with Yup schema', {
        level: 'warning',
        tags: {
          component: 'applications',
          action: 'yup_validation_failed',
          error_category: 'validation',
          entity: 'application',
          operation: 'create',
        },
        extra: {
          requestId,
          failedFields: validationError.inner?.map((err) => err.path) || [],
          totalErrors: validationError.inner?.length || 0,
          validationErrors:
            validationError.inner?.map((err) => ({
              field: err.path,
              message: err.message,
            })) || [],
        },
      });

      if (client) await client.cleanup();

      const errors = {};
      validationError.inner.forEach((error) => {
        errors[error.path] = error.message;
      });

      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(requestId, responseTime);

      return NextResponse.json({ errors }, { status: 400, headers });
    }

    // ===== ÉTAPE 7: VALIDATION DES CHAMPS REQUIS (SÉCURITÉ SUPPLÉMENTAIRE) =====
    if (
      !sanitizedName ||
      !sanitizedLink ||
      !sanitizedAdmin ||
      !sanitizedFee ||
      !sanitizedRent ||
      !sanitizedImageUrls?.length ||
      !sanitizedTemplateId ||
      !sanitizedLevel
    ) {
      logger.warn(
        'Application validation failed - missing required fields after sanitization',
        {
          requestId,
          component: 'applications',
          action: 'validation_failed',
          operation: 'add_application',
          missingFields: {
            name: !sanitizedName,
            link: !sanitizedLink,
            admin: !sanitizedAdmin,
            fee: !sanitizedFee,
            rent: !sanitizedRent,
            images: !sanitizedImageUrls?.length,
            templateId: !sanitizedTemplateId,
            level: !sanitizedLevel,
          },
        },
      );

      // Capturer l'erreur de validation avec Sentry
      captureMessage(
        'Application validation failed - missing required fields after sanitization',
        {
          level: 'warning',
          tags: {
            component: 'applications',
            action: 'validation_failed',
            error_category: 'validation',
            entity: 'application',
            operation: 'create',
          },
          extra: {
            requestId,
            missingFields: {
              name: !sanitizedName,
              link: !sanitizedLink,
              admin: !sanitizedAdmin,
              fee: !sanitizedFee,
              rent: !sanitizedRent,
              images: !sanitizedImageUrls?.length,
              templateId: !sanitizedTemplateId,
              level: !sanitizedLevel,
            },
          },
        },
      );

      if (client) await client.cleanup();

      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(requestId, responseTime);

      return NextResponse.json(
        { message: 'All required fields must be provided' },
        { status: 400, headers },
      );
    }

    logger.debug('Application validation passed', {
      requestId,
      component: 'applications',
      action: 'validation_success',
      operation: 'add_application',
    });

    // ===== ÉTAPE 8: INSERTION EN BASE DE DONNÉES =====
    let result;
    try {
      const queryText = `
        INSERT INTO catalog.applications (
          application_name,
          application_link,
          application_admin_link,
          application_description,
          application_category,
          application_fee,
          application_rent,
          application_images,
          application_template_id,
          application_level
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING application_id
      `;

      const values = [
        sanitizedName,
        sanitizedLink,
        sanitizedAdmin,
        sanitizedDescription || null,
        sanitizedCategory,
        sanitizedFee,
        sanitizedRent,
        sanitizedImageUrls,
        sanitizedTemplateId,
        sanitizedLevel,
      ];

      logger.debug('Executing application insertion query', {
        requestId,
        component: 'applications',
        action: 'query_start',
        operation: 'add_application',
        table: 'catalog.applications',
      });

      result = await client.query(queryText, values);

      logger.debug('Application insertion query executed successfully', {
        requestId,
        component: 'applications',
        action: 'query_success',
        operation: 'add_application',
        newApplicationId: result.rows[0]?.application_id,
      });
    } catch (insertError) {
      const errorCategory = categorizeError(insertError);

      logger.error('Application Insertion Error', {
        category: errorCategory,
        message: insertError.message,
        operation: 'INSERT INTO applications',
        table: 'catalog.applications',
        requestId,
        component: 'applications',
        action: 'query_failed',
      });

      // Capturer l'erreur d'insertion avec Sentry
      captureDatabaseError(insertError, {
        tags: {
          component: 'applications',
          action: 'insertion_failed',
          operation: 'INSERT',
          entity: 'application',
        },
        extra: {
          requestId,
          table: 'catalog.applications',
          queryType: 'application_insertion',
          postgresCode: insertError.code,
          postgresDetail: insertError.detail ? '[Filtered]' : undefined,
          ip: anonymizeIp(extractRealIp(request)),
          rateLimitingApplied: true,
        },
      });

      if (client) await client.cleanup();

      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(requestId, responseTime);

      return NextResponse.json(
        { error: 'Failed to add application to database' },
        { status: 500, headers },
      );
    }

    // ===== ÉTAPE 9: INVALIDATION DU CACHE APRÈS SUCCÈS =====
    const newApplicationId = result.rows[0].application_id;

    // Invalider le cache des applications après ajout réussi
    invalidateApplicationsCache(requestId);

    // ===== ÉTAPE 10: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Application addition successful', {
      newApplicationId,
      applicationName: sanitizedName,
      applicationCategory: sanitizedCategory,
      applicationFee: sanitizedFee,
      applicationRent: sanitizedRent,
      imageCount: sanitizedImageUrls.length,
      response_time_ms: responseTime,
      database_operations: 2, // connection + insert
      cache_invalidated: true,
      success: true,
      requestId,
      component: 'applications',
      action: 'addition_success',
      entity: 'application',
      rateLimitingApplied: true,
      operation: 'add_application',
      sanitizationApplied: true,
      yupValidationApplied: true,
    });

    // Capturer le succès de l'ajout avec Sentry
    captureMessage('Application addition completed successfully', {
      level: 'info',
      tags: {
        component: 'applications',
        action: 'addition_success',
        success: 'true',
        entity: 'application',
        operation: 'create',
      },
      extra: {
        requestId,
        newApplicationId,
        applicationName: sanitizedName,
        applicationCategory: sanitizedCategory,
        responseTimeMs: responseTime,
        databaseOperations: 2,
        cacheInvalidated: true,
        ip: anonymizeIp(extractRealIp(request)),
        rateLimitingApplied: true,
        sanitizationApplied: true,
        yupValidationApplied: true,
      },
    });

    if (client) await client.cleanup();

    // Créer les headers de succès
    const headers = createResponseHeaders(requestId, responseTime);

    return NextResponse.json(
      {
        message: 'Application added successfully',
        applicationId: newApplicationId,
        success: true,
        data: {
          application_id: newApplicationId,
          application_name: sanitizedName,
          application_category: sanitizedCategory,
          application_fee: sanitizedFee,
          application_rent: sanitizedRent,
        },
        meta: {
          requestId,
          timestamp: new Date().toISOString(),
        },
      },
      {
        status: 201,
        headers: headers,
      },
    );
  } catch (error) {
    // ===== GESTION GLOBALE DES ERREURS =====
    const errorCategory = categorizeError(error);
    const responseTime = Date.now() - startTime;

    logger.error('Global Add Application Error', {
      category: errorCategory,
      response_time_ms: responseTime,
      reached_global_handler: true,
      error_name: error.name,
      error_message: error.message,
      stack_available: !!error.stack,
      requestId,
      component: 'applications',
      action: 'global_error_handler',
      entity: 'application',
      operation: 'add_application',
    });

    // Capturer l'erreur globale avec Sentry
    captureException(error, {
      level: 'error',
      tags: {
        component: 'applications',
        action: 'global_error_handler',
        error_category: errorCategory,
        critical: 'true',
        entity: 'application',
        operation: 'create',
      },
      extra: {
        requestId,
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'application_addition',
        ip: anonymizeIp(extractRealIp(request)),
        rateLimitingApplied: true,
      },
    });

    if (client) await client.cleanup();

    // Créer les headers même en cas d'erreur globale
    const headers = createResponseHeaders(requestId, responseTime);

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: 'Failed to add application',
        success: false,
        requestId,
      },
      {
        status: 500,
        headers: headers,
      },
    );
  }
}
