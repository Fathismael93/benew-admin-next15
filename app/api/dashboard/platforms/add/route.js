// app/api/dashboard/platforms/add/route.js
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
import { sanitizePlatformInputsStrict } from '@/utils/sanitizers/sanitizePlatformInputs';
import { platformAddingSchema } from '@/utils/schemas/platformSchema';
// AJOUT POUR L'INVALIDATION DU CACHE
import { dashboardCache, getDashboardCacheKey } from '@/utils/cache';

// ----- CONFIGURATION DU RATE LIMITING POUR L'AJOUT DE PLATEFORMES -----

// Créer le middleware de rate limiting spécifique pour l'ajout de plateformes
const addPlatformRateLimit = applyRateLimit('CONTENT_API', {
  // Configuration personnalisée pour l'ajout de plateformes (plus restrictif car données sensibles)
  windowMs: 10 * 60 * 1000, // 10 minutes (plus restrictif pour paiement)
  max: 5, // 5 ajouts par 10 minutes (très restrictif car données bancaires)
  message:
    "Trop de tentatives d'ajout de plateformes de paiement. Veuillez réessayer dans quelques minutes.",
  skipSuccessfulRequests: false, // Compter tous les ajouts réussis
  skipFailedRequests: false, // Compter aussi les échecs
  prefix: 'add_platform', // Préfixe spécifique pour l'ajout de plateformes

  // Fonction personnalisée pour générer la clé (basée sur IP)
  keyGenerator: (req) => {
    const ip = extractRealIp(req);
    return `add_platform:ip:${ip}`;
  },
});

// ----- FONCTION D'INVALIDATION DU CACHE -----
const invalidatePlatformsCache = (requestId) => {
  try {
    const cacheKey = getDashboardCacheKey('platforms_list', {
      endpoint: 'dashboard_platforms',
      version: '1.0',
    });

    const cacheInvalidated = dashboardCache.platforms.delete(cacheKey);

    logger.debug('Platforms cache invalidation', {
      requestId,
      component: 'platforms',
      action: 'cache_invalidation',
      operation: 'add_platform',
      cacheKey,
      invalidated: cacheInvalidated,
    });

    // Capturer l'invalidation du cache avec Sentry
    captureMessage('Platforms cache invalidated after addition', {
      level: 'info',
      tags: {
        component: 'platforms',
        action: 'cache_invalidation',
        entity: 'platform',
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
    logger.warn('Failed to invalidate platforms cache', {
      requestId,
      component: 'platforms',
      action: 'cache_invalidation_failed',
      operation: 'add_platform',
      error: cacheError.message,
    });

    captureException(cacheError, {
      level: 'warning',
      tags: {
        component: 'platforms',
        action: 'cache_invalidation_failed',
        error_category: 'cache',
        entity: 'platform',
        operation: 'create',
      },
      extra: {
        requestId,
      },
    });

    return false;
  }
};

// ----- FONCTION POUR CRÉER LES HEADERS DE RÉPONSE SPÉCIFIQUES AUX PLATEFORMES -----
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

    // Anti-cache strict pour les mutations sensibles
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

    // ===== HEADERS SPÉCIFIQUES AUX PLATEFORMES DE PAIEMENT =====
    // Rate limiting ultra-strict pour données financières (5/10min)
    'X-RateLimit-Window': '600', // 10 minutes en secondes
    'X-RateLimit-Limit': '5',

    // Validation spécifique aux plateformes
    'X-Resource-Validation': 'platform-data',
    'X-Uniqueness-Validation': 'platform-name-required',
    'X-Financial-Data-Protection': 'enabled',
    'X-Payment-Platform-Security': 'enhanced',

    // Cache et base de données
    'X-Cache-Invalidation': 'platforms',
    'X-Database-Operations': '3', // connection + uniqueness check + insert

    // Headers de traçabilité spécifiques
    'X-Request-ID': requestId,
    'X-Response-Time': `${responseTime}ms`,
    'X-API-Version': '1.0',
    'X-Transaction-Type': 'mutation',
    'X-Entity-Type': 'platform',
    'X-Operation-Type': 'create',
    'X-Operation-Criticality': 'high',

    // Headers de validation et sécurité
    'X-Sanitization-Applied': 'true',
    'X-Yup-Validation-Applied': 'true',
    'X-Uniqueness-Check-Applied': 'true',

    // Headers de performance et traçabilité
    Vary: 'Authorization, Content-Type',
    'X-Permitted-Cross-Domain-Policies': 'none',

    // Headers spécifiques aux données financières
    'X-Sensitive-Data-Handling': 'financial',
    'X-Data-Classification': 'restricted',
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

  logger.info('Add Platform API called', {
    timestamp: new Date().toISOString(),
    requestId,
    component: 'platforms',
    action: 'api_start',
    method: 'POST',
    operation: 'add_platform',
  });

  // Capturer le début du processus d'ajout de plateforme
  captureMessage('Add platform process started', {
    level: 'info',
    tags: {
      component: 'platforms',
      action: 'process_start',
      api_endpoint: '/api/dashboard/platforms/add',
      entity: 'platform',
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
    logger.debug('Applying rate limiting for add platform API', {
      requestId,
      component: 'platforms',
      action: 'rate_limit_start',
      operation: 'add_platform',
    });

    const rateLimitResponse = await addPlatformRateLimit(request);

    // Si le rate limiter retourne une réponse, cela signifie que la limite est dépassée
    if (rateLimitResponse) {
      logger.warn('Add platform API rate limit exceeded', {
        requestId,
        component: 'platforms',
        action: 'rate_limit_exceeded',
        operation: 'add_platform',
        ip: anonymizeIp(extractRealIp(request)),
      });

      // Capturer l'événement de rate limiting avec Sentry
      captureMessage('Add platform API rate limit exceeded', {
        level: 'warning',
        tags: {
          component: 'platforms',
          action: 'rate_limit_exceeded',
          error_category: 'rate_limiting',
          entity: 'platform',
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
      component: 'platforms',
      action: 'rate_limit_passed',
      operation: 'add_platform',
    });

    // ===== ÉTAPE 2: VÉRIFICATION AUTHENTIFICATION =====
    logger.debug('Verifying user authentication', {
      requestId,
      component: 'platforms',
      action: 'auth_verification_start',
      operation: 'add_platform',
    });

    await isAuthenticatedUser(request, NextResponse);

    logger.debug('User authentication verified successfully', {
      requestId,
      component: 'platforms',
      action: 'auth_verification_success',
      operation: 'add_platform',
    });

    // ===== ÉTAPE 3: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
      logger.debug('Database connection successful', {
        requestId,
        component: 'platforms',
        action: 'db_connection_success',
        operation: 'add_platform',
      });
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Database Connection Error during platform addition', {
        category: errorCategory,
        message: dbConnectionError.message,
        timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
        requestId,
        component: 'platforms',
        action: 'db_connection_failed',
        operation: 'add_platform',
      });

      // Capturer l'erreur de connexion DB avec Sentry
      captureDatabaseError(dbConnectionError, {
        tags: {
          component: 'platforms',
          action: 'db_connection_failed',
          operation: 'connection',
          entity: 'platform',
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
        component: 'platforms',
        action: 'body_parse_success',
        operation: 'add_platform',
      });
    } catch (parseError) {
      const errorCategory = categorizeError(parseError);

      logger.error('JSON Parse Error during platform addition', {
        category: errorCategory,
        message: parseError.message,
        requestId,
        component: 'platforms',
        action: 'json_parse_error',
        operation: 'add_platform',
        headers: {
          'content-type': request.headers.get('content-type'),
          'user-agent': request.headers.get('user-agent')?.substring(0, 100),
        },
      });

      // Capturer l'erreur de parsing avec Sentry
      captureException(parseError, {
        level: 'error',
        tags: {
          component: 'platforms',
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

    const { platformName, platformNumber } = body;

    logger.debug('Platform data extracted from request', {
      requestId,
      component: 'platforms',
      action: 'data_extraction',
      operation: 'add_platform',
      hasPlatformName: !!platformName,
      hasPlatformNumber: !!platformNumber,
    });

    // ===== ÉTAPE 5: SANITIZATION DES INPUTS =====
    logger.debug('Sanitizing platform inputs', {
      requestId,
      component: 'platforms',
      action: 'input_sanitization',
      operation: 'add_platform',
    });

    const sanitizedInputs = sanitizePlatformInputsStrict({
      platformName,
      platformNumber,
    });

    // Utiliser les données sanitizées pour la suite du processus
    const {
      platformName: sanitizedPlatformName,
      platformNumber: sanitizedPlatformNumber,
    } = sanitizedInputs;

    logger.debug('Input sanitization completed', {
      requestId,
      component: 'platforms',
      action: 'input_sanitization_completed',
      operation: 'add_platform',
    });

    // ===== ÉTAPE 6: VALIDATION AVEC YUP =====
    try {
      // Valider les données sanitizées avec le schema Yup
      await platformAddingSchema.validate(
        {
          platformName: sanitizedPlatformName,
          platformNumber: sanitizedPlatformNumber,
        },
        { abortEarly: false },
      );

      logger.debug('Platform validation with Yup passed', {
        requestId,
        component: 'platforms',
        action: 'yup_validation_success',
        operation: 'add_platform',
      });
    } catch (validationError) {
      const errorCategory = categorizeError(validationError);

      logger.error('Platform Validation Error with Yup', {
        category: errorCategory,
        failed_fields: validationError.inner?.map((err) => err.path) || [],
        total_errors: validationError.inner?.length || 0,
        requestId,
        component: 'platforms',
        action: 'yup_validation_failed',
        operation: 'add_platform',
      });

      // Capturer l'erreur de validation avec Sentry
      captureMessage('Platform validation failed with Yup schema', {
        level: 'warning',
        tags: {
          component: 'platforms',
          action: 'yup_validation_failed',
          error_category: 'validation',
          entity: 'platform',
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
    if (!sanitizedPlatformName || !sanitizedPlatformNumber) {
      logger.warn(
        'Platform validation failed - missing required fields after sanitization',
        {
          requestId,
          component: 'platforms',
          action: 'validation_failed',
          operation: 'add_platform',
          missingFields: {
            platformName: !sanitizedPlatformName,
            platformNumber: !sanitizedPlatformNumber,
          },
        },
      );

      // Capturer l'erreur de validation avec Sentry
      captureMessage(
        'Platform validation failed - missing required fields after sanitization',
        {
          level: 'warning',
          tags: {
            component: 'platforms',
            action: 'validation_failed',
            error_category: 'validation',
            entity: 'platform',
            operation: 'create',
          },
          extra: {
            requestId,
            missingFields: {
              platformName: !sanitizedPlatformName,
              platformNumber: !sanitizedPlatformNumber,
            },
          },
        },
      );

      if (client) await client.cleanup();

      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(requestId, responseTime);

      return NextResponse.json(
        { message: 'Platform name and number are required' },
        { status: 400, headers },
      );
    }

    logger.debug('Platform validation passed', {
      requestId,
      component: 'platforms',
      action: 'validation_success',
      operation: 'add_platform',
    });

    // ===== ÉTAPE 8: VÉRIFICATION DE L'UNICITÉ =====
    let existingPlatform;
    try {
      const uniqueCheckQuery = `
        SELECT platform_id, platform_name, platform_number 
        FROM admin.platforms 
        WHERE LOWER(platform_name) = LOWER($1)
      `;

      logger.debug('Checking platform uniqueness', {
        requestId,
        component: 'platforms',
        action: 'uniqueness_check_start',
        operation: 'add_platform',
        table: 'admin.platforms',
      });

      existingPlatform = await client.query(uniqueCheckQuery, [
        sanitizedPlatformName,
      ]);

      if (existingPlatform.rows.length > 0) {
        const duplicateField =
          existingPlatform.rows[0].platform_name.toLowerCase() ===
          sanitizedPlatformName.toLowerCase()
            ? 'platform_name'
            : 'platform_number';

        logger.warn('Platform uniqueness violation detected', {
          requestId,
          component: 'platforms',
          action: 'uniqueness_violation',
          operation: 'add_platform',
          duplicateField,
          existingPlatformId: existingPlatform.rows[0].platform_id,
        });

        // Capturer la violation d'unicité avec Sentry
        captureMessage('Platform uniqueness violation detected', {
          level: 'warning',
          tags: {
            component: 'platforms',
            action: 'uniqueness_violation',
            error_category: 'business_logic',
            entity: 'platform',
            operation: 'create',
          },
          extra: {
            requestId,
            duplicateField,
            ip: anonymizeIp(extractRealIp(request)),
          },
        });

        if (client) await client.cleanup();

        const errorMessage =
          duplicateField === 'platform_name'
            ? 'A platform with this name already exists'
            : 'A platform with this number already exists';

        const responseTime = Date.now() - startTime;
        const headers = createResponseHeaders(requestId, responseTime);

        return NextResponse.json(
          {
            error: errorMessage,
            field: duplicateField,
          },
          { status: 409, headers },
        );
      }

      logger.debug('Platform uniqueness check passed', {
        requestId,
        component: 'platforms',
        action: 'uniqueness_check_success',
        operation: 'add_platform',
      });
    } catch (uniqueCheckError) {
      const errorCategory = categorizeError(uniqueCheckError);

      logger.error('Platform Uniqueness Check Error', {
        category: errorCategory,
        message: uniqueCheckError.message,
        operation: 'SELECT FROM platforms',
        table: 'admin.platforms',
        requestId,
        component: 'platforms',
        action: 'uniqueness_check_failed',
      });

      // Capturer l'erreur de vérification d'unicité avec Sentry
      captureDatabaseError(uniqueCheckError, {
        tags: {
          component: 'platforms',
          action: 'uniqueness_check_failed',
          operation: 'SELECT',
          entity: 'platform',
        },
        extra: {
          requestId,
          table: 'admin.platforms',
          queryType: 'uniqueness_check',
          postgresCode: uniqueCheckError.code,
          postgresDetail: uniqueCheckError.detail ? '[Filtered]' : undefined,
          ip: anonymizeIp(extractRealIp(request)),
        },
      });

      if (client) await client.cleanup();

      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(requestId, responseTime);

      return NextResponse.json(
        { error: 'Failed to verify platform uniqueness' },
        { status: 500, headers },
      );
    }

    // ===== ÉTAPE 9: INSERTION EN BASE DE DONNÉES =====
    let result;
    try {
      const queryText = `
        INSERT INTO admin.platforms (
          platform_name,
          platform_number
        ) VALUES ($1, $2)
        RETURNING platform_id, platform_name, platform_number, created_at
      `;

      const values = [sanitizedPlatformName, sanitizedPlatformNumber];

      logger.debug('Executing platform insertion query', {
        requestId,
        component: 'platforms',
        action: 'query_start',
        operation: 'add_platform',
        table: 'admin.platforms',
      });

      result = await client.query(queryText, values);

      logger.debug('Platform insertion query executed successfully', {
        requestId,
        component: 'platforms',
        action: 'query_success',
        operation: 'add_platform',
        newPlatformId: result.rows[0]?.platform_id,
      });
    } catch (insertError) {
      const errorCategory = categorizeError(insertError);

      logger.error('Platform Insertion Error', {
        category: errorCategory,
        message: insertError.message,
        operation: 'INSERT INTO platforms',
        table: 'admin.platforms',
        requestId,
        component: 'platforms',
        action: 'query_failed',
      });

      // Capturer l'erreur d'insertion avec Sentry
      captureDatabaseError(insertError, {
        tags: {
          component: 'platforms',
          action: 'insertion_failed',
          operation: 'INSERT',
          entity: 'platform',
        },
        extra: {
          requestId,
          table: 'admin.platforms',
          queryType: 'platform_insertion',
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
        { error: 'Failed to add platform to database' },
        { status: 500, headers },
      );
    }

    // ===== ÉTAPE 10: INVALIDATION DU CACHE APRÈS SUCCÈS =====
    const newPlatformData = result.rows[0];

    // Invalider le cache des plateformes après ajout réussi
    invalidatePlatformsCache(requestId);

    // ===== ÉTAPE 11: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Platform addition successful', {
      newPlatformId: newPlatformData.platform_id,
      platformName: sanitizedPlatformName,
      response_time_ms: responseTime,
      database_operations: 3, // connection + uniqueness check + insert
      cache_invalidated: true,
      success: true,
      requestId,
      component: 'platforms',
      action: 'addition_success',
      entity: 'platform',
      rateLimitingApplied: true,
      operation: 'add_platform',
      sanitizationApplied: true,
      yupValidationApplied: true,
      uniquenessCheckApplied: true,
    });

    // Capturer le succès de l'ajout avec Sentry
    captureMessage('Platform addition completed successfully', {
      level: 'info',
      tags: {
        component: 'platforms',
        action: 'addition_success',
        success: 'true',
        entity: 'platform',
        operation: 'create',
      },
      extra: {
        requestId,
        newPlatformId: newPlatformData.platform_id,
        platformName: sanitizedPlatformName,
        responseTimeMs: responseTime,
        databaseOperations: 3,
        cacheInvalidated: true,
        ip: anonymizeIp(extractRealIp(request)),
        rateLimitingApplied: true,
        sanitizationApplied: true,
        yupValidationApplied: true,
        uniquenessCheckApplied: true,
      },
    });

    if (client) await client.cleanup();

    // Créer les headers de succès
    const headers = createResponseHeaders(requestId, responseTime);

    return NextResponse.json(
      {
        message: 'Platform added successfully',
        platform: {
          id: newPlatformData.platform_id,
          name: newPlatformData.platform_name,
          number: newPlatformData.platform_number,
          createdAt: newPlatformData.created_at,
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

    logger.error('Global Add Platform Error', {
      category: errorCategory,
      response_time_ms: responseTime,
      reached_global_handler: true,
      error_name: error.name,
      error_message: error.message,
      stack_available: !!error.stack,
      requestId,
      component: 'platforms',
      action: 'global_error_handler',
      entity: 'platform',
      operation: 'add_platform',
    });

    // Capturer l'erreur globale avec Sentry
    captureException(error, {
      level: 'error',
      tags: {
        component: 'platforms',
        action: 'global_error_handler',
        error_category: errorCategory,
        critical: 'true',
        entity: 'platform',
        operation: 'create',
      },
      extra: {
        requestId,
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'platform_addition',
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
        message: 'Failed to add platform',
        requestId,
      },
      {
        status: 500,
        headers: headers,
      },
    );
  }
}
