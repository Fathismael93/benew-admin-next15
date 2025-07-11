// app/api/dashboard/templates/add/route.js
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
import { sanitizeTemplateInputsStrict } from '@/utils/sanitizers/sanitizeTemplateInputs';
import { templateAddingSchema } from '@/utils/schemas/templateSchema';
// AJOUT POUR L'INVALIDATION DU CACHE
import { dashboardCache, getDashboardCacheKey } from '@/utils/cache';

// ----- CONFIGURATION DU RATE LIMITING POUR L'AJOUT DE TEMPLATES -----

// Créer le middleware de rate limiting spécifique pour l'ajout de templates
const addTemplateRateLimit = applyRateLimit('CONTENT_API', {
  // Configuration personnalisée pour l'ajout de templates
  windowMs: 5 * 60 * 1000, // 5 minutes (plus strict pour les mutations)
  max: 10, // 10 ajouts par 5 minutes (plus restrictif car création)
  message:
    "Trop de tentatives d'ajout de templates. Veuillez réessayer dans quelques minutes.",
  skipSuccessfulRequests: false, // Compter tous les ajouts réussis
  skipFailedRequests: false, // Compter aussi les échecs
  prefix: 'add_template', // Préfixe spécifique pour l'ajout de templates

  // Fonction personnalisée pour générer la clé (basée sur IP)
  keyGenerator: (req) => {
    const ip = extractRealIp(req);
    return `add_template:ip:${ip}`;
  },
});

// ----- FONCTION D'INVALIDATION DU CACHE -----
const invalidateTemplatesCache = (requestId) => {
  try {
    const cacheKey = getDashboardCacheKey('templates_list', {
      endpoint: 'dashboard_templates',
      version: '1.0',
    });

    const cacheInvalidated = dashboardCache.templates.delete(cacheKey);

    logger.debug('Templates cache invalidation', {
      requestId,
      component: 'templates',
      action: 'cache_invalidation',
      operation: 'add_template',
      cacheKey,
      invalidated: cacheInvalidated,
    });

    // Capturer l'invalidation du cache avec Sentry
    captureMessage('Templates cache invalidated after addition', {
      level: 'info',
      tags: {
        component: 'templates',
        action: 'cache_invalidation',
        entity: 'template',
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
    logger.warn('Failed to invalidate templates cache', {
      requestId,
      component: 'templates',
      action: 'cache_invalidation_failed',
      operation: 'add_template',
      error: cacheError.message,
    });

    captureException(cacheError, {
      level: 'warning',
      tags: {
        component: 'templates',
        action: 'cache_invalidation_failed',
        error_category: 'cache',
        entity: 'template',
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
    // CORS spécifique pour mutations
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

    // Sécurité pour mutations de données
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Resource-Policy': 'same-site',

    // CSP pour manipulation de données
    'Content-Security-Policy': "default-src 'none'; connect-src 'self'",

    // Headers de traçabilité
    'X-Request-ID': requestId,
    'X-Response-Time': `${responseTime}ms`,
    'X-API-Version': '1.0',
    'X-Transaction-Type': 'mutation',
    'X-Cache-Invalidation': 'templates',

    // Rate limiting info
    'X-RateLimit-Window': '300', // 5 minutes en secondes
    'X-RateLimit-Limit': '10',
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

  logger.info('Add Template API called', {
    timestamp: new Date().toISOString(),
    requestId,
    component: 'templates',
    action: 'api_start',
    method: 'POST',
    operation: 'add_template',
  });

  // Capturer le début du processus d'ajout de template
  captureMessage('Add template process started', {
    level: 'info',
    tags: {
      component: 'templates',
      action: 'process_start',
      api_endpoint: '/api/dashboard/templates/add',
      entity: 'template',
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
    logger.debug('Applying rate limiting for add template API', {
      requestId,
      component: 'templates',
      action: 'rate_limit_start',
      operation: 'add_template',
    });

    const rateLimitResponse = await addTemplateRateLimit(request);

    // Si le rate limiter retourne une réponse, cela signifie que la limite est dépassée
    if (rateLimitResponse) {
      logger.warn('Add template API rate limit exceeded', {
        requestId,
        component: 'templates',
        action: 'rate_limit_exceeded',
        operation: 'add_template',
        ip: anonymizeIp(extractRealIp(request)),
      });

      // Capturer l'événement de rate limiting avec Sentry
      captureMessage('Add template API rate limit exceeded', {
        level: 'warning',
        tags: {
          component: 'templates',
          action: 'rate_limit_exceeded',
          error_category: 'rate_limiting',
          entity: 'template',
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
      component: 'templates',
      action: 'rate_limit_passed',
      operation: 'add_template',
    });

    // ===== ÉTAPE 2: VÉRIFICATION AUTHENTIFICATION =====
    logger.debug('Verifying user authentication', {
      requestId,
      component: 'templates',
      action: 'auth_verification_start',
      operation: 'add_template',
    });

    await isAuthenticatedUser(request, NextResponse);

    logger.debug('User authentication verified successfully', {
      requestId,
      component: 'templates',
      action: 'auth_verification_success',
      operation: 'add_template',
    });

    // ===== ÉTAPE 3: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
      logger.debug('Database connection successful', {
        requestId,
        component: 'templates',
        action: 'db_connection_success',
        operation: 'add_template',
      });
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Database Connection Error during template addition', {
        category: errorCategory,
        message: dbConnectionError.message,
        timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
        requestId,
        component: 'templates',
        action: 'db_connection_failed',
        operation: 'add_template',
      });

      // Capturer l'erreur de connexion DB avec Sentry
      captureDatabaseError(dbConnectionError, {
        tags: {
          component: 'templates',
          action: 'db_connection_failed',
          operation: 'connection',
          entity: 'template',
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
        component: 'templates',
        action: 'body_parse_success',
        operation: 'add_template',
      });
    } catch (parseError) {
      const errorCategory = categorizeError(parseError);

      logger.error('JSON Parse Error during template addition', {
        category: errorCategory,
        message: parseError.message,
        requestId,
        component: 'templates',
        action: 'json_parse_error',
        operation: 'add_template',
        headers: {
          'content-type': request.headers.get('content-type'),
          'user-agent': request.headers.get('user-agent')?.substring(0, 100),
        },
      });

      // Capturer l'erreur de parsing avec Sentry
      captureException(parseError, {
        level: 'error',
        tags: {
          component: 'templates',
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

    const { templateName, templateImageId, templateHasWeb, templateHasMobile } =
      body;

    logger.debug('Template data extracted from request', {
      requestId,
      component: 'templates',
      action: 'data_extraction',
      operation: 'add_template',
      hasTemplateName: !!templateName,
      hasTemplateImageId: !!templateImageId,
    });

    // ===== ÉTAPE 5: SANITIZATION DES INPUTS =====
    logger.debug('Sanitizing template inputs', {
      requestId,
      component: 'templates',
      action: 'input_sanitization',
      operation: 'add_template',
    });

    const sanitizedInputs = sanitizeTemplateInputsStrict({
      templateName,
      templateImageId,
      templateHasWeb,
      templateHasMobile,
    });

    // Utiliser les données sanitizées pour la suite du processus
    const {
      templateName: sanitizedTemplateName,
      templateImageId: sanitizedTemplateImageId,
      templateHasWeb: sanitizedTemplateHasWeb,
      templateHasMobile: sanitizedTemplateHasMobile,
    } = sanitizedInputs;

    logger.debug('Input sanitization completed', {
      requestId,
      component: 'templates',
      action: 'input_sanitization_completed',
      operation: 'add_template',
    });

    // ===== ÉTAPE 6: VALIDATION AVEC YUP =====
    try {
      // Valider les données sanitizées avec le schema Yup
      await templateAddingSchema.validate(
        {
          templateName: sanitizedTemplateName,
          templateImageId: sanitizedTemplateImageId,
          templateHasWeb: sanitizedTemplateHasWeb,
          templateHasMobile: sanitizedTemplateHasMobile,
        },
        { abortEarly: false },
      );

      logger.debug('Template validation with Yup passed', {
        requestId,
        component: 'templates',
        action: 'yup_validation_success',
        operation: 'add_template',
      });
    } catch (validationError) {
      const errorCategory = categorizeError(validationError);

      logger.error('Template Validation Error with Yup', {
        category: errorCategory,
        failed_fields: validationError.inner?.map((err) => err.path) || [],
        total_errors: validationError.inner?.length || 0,
        requestId,
        component: 'templates',
        action: 'yup_validation_failed',
        operation: 'add_template',
      });

      // Capturer l'erreur de validation avec Sentry
      captureMessage('Template validation failed with Yup schema', {
        level: 'warning',
        tags: {
          component: 'templates',
          action: 'yup_validation_failed',
          error_category: 'validation',
          entity: 'template',
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
    if (!sanitizedTemplateName || !sanitizedTemplateImageId) {
      logger.warn(
        'Template validation failed - missing required fields after sanitization',
        {
          requestId,
          component: 'templates',
          action: 'validation_failed',
          operation: 'add_template',
          missingFields: {
            templateName: !sanitizedTemplateName,
            templateImageId: !sanitizedTemplateImageId,
          },
        },
      );

      // Capturer l'erreur de validation avec Sentry
      captureMessage(
        'Template validation failed - missing required fields after sanitization',
        {
          level: 'warning',
          tags: {
            component: 'templates',
            action: 'validation_failed',
            error_category: 'validation',
            entity: 'template',
            operation: 'create',
          },
          extra: {
            requestId,
            missingFields: {
              templateName: !sanitizedTemplateName,
              templateImageId: !sanitizedTemplateImageId,
            },
          },
        },
      );

      if (client) await client.cleanup();

      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(requestId, responseTime);

      return NextResponse.json(
        { message: 'Template name and image are required' },
        { status: 400, headers },
      );
    }

    logger.debug('Template validation passed', {
      requestId,
      component: 'templates',
      action: 'validation_success',
      operation: 'add_template',
    });

    // ===== ÉTAPE 8: INSERTION EN BASE DE DONNÉES =====
    let result;
    try {
      const queryText = `
        INSERT INTO catalog.templates (
          template_name,
          template_image,
          template_has_web,
          template_has_mobile
        ) VALUES ($1, $2, $3, $4)
        RETURNING template_id
      `;

      const values = [
        sanitizedTemplateName,
        sanitizedTemplateImageId || null,
        sanitizedTemplateHasWeb === undefined ? true : sanitizedTemplateHasWeb,
        sanitizedTemplateHasMobile === undefined
          ? false
          : sanitizedTemplateHasMobile,
      ];

      logger.debug('Executing template insertion query', {
        requestId,
        component: 'templates',
        action: 'query_start',
        operation: 'add_template',
        table: 'catalog.templates',
      });

      result = await client.query(queryText, values);

      logger.debug('Template insertion query executed successfully', {
        requestId,
        component: 'templates',
        action: 'query_success',
        operation: 'add_template',
        newTemplateId: result.rows[0]?.template_id,
      });
    } catch (insertError) {
      const errorCategory = categorizeError(insertError);

      logger.error('Template Insertion Error', {
        category: errorCategory,
        message: insertError.message,
        operation: 'INSERT INTO templates',
        table: 'catalog.templates',
        requestId,
        component: 'templates',
        action: 'query_failed',
      });

      // Capturer l'erreur d'insertion avec Sentry
      captureDatabaseError(insertError, {
        tags: {
          component: 'templates',
          action: 'insertion_failed',
          operation: 'INSERT',
          entity: 'template',
        },
        extra: {
          requestId,
          table: 'catalog.templates',
          queryType: 'template_insertion',
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
        { error: 'Failed to add template to database' },
        { status: 500, headers },
      );
    }

    // ===== ÉTAPE 9: INVALIDATION DU CACHE APRÈS SUCCÈS =====
    const newTemplateId = result.rows[0].template_id;

    // Invalider le cache des templates après ajout réussi
    invalidateTemplatesCache(requestId);

    // ===== ÉTAPE 10: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Template addition successful', {
      newTemplateId,
      templateName: sanitizedTemplateName,
      response_time_ms: responseTime,
      database_operations: 2, // connection + insert
      cache_invalidated: true,
      success: true,
      requestId,
      component: 'templates',
      action: 'addition_success',
      entity: 'template',
      rateLimitingApplied: true,
      operation: 'add_template',
      sanitizationApplied: true,
      yupValidationApplied: true,
    });

    // Capturer le succès de l'ajout avec Sentry
    captureMessage('Template addition completed successfully', {
      level: 'info',
      tags: {
        component: 'templates',
        action: 'addition_success',
        success: 'true',
        entity: 'template',
        operation: 'create',
      },
      extra: {
        requestId,
        newTemplateId,
        templateName: sanitizedTemplateName,
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
        message: 'Template added successfully',
        templateId: newTemplateId,
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

    logger.error('Global Add Template Error', {
      category: errorCategory,
      response_time_ms: responseTime,
      reached_global_handler: true,
      error_name: error.name,
      error_message: error.message,
      stack_available: !!error.stack,
      requestId,
      component: 'templates',
      action: 'global_error_handler',
      entity: 'template',
      operation: 'add_template',
    });

    // Capturer l'erreur globale avec Sentry
    captureException(error, {
      level: 'error',
      tags: {
        component: 'templates',
        action: 'global_error_handler',
        error_category: errorCategory,
        critical: 'true',
        entity: 'template',
        operation: 'create',
      },
      extra: {
        requestId,
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'template_addition',
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
        message: 'Failed to add template',
        requestId,
      },
      {
        status: 500,
        headers: headers,
      },
    );
  }
}
