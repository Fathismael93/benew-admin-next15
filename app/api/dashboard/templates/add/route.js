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
import { dashboardCache, getDashboardCacheKey } from '@/utils/cache';

// Créer le middleware de rate limiting spécifique pour l'ajout de templates
const addTemplateRateLimit = applyRateLimit('CONTENT_API', {
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // 10 ajouts par 5 minutes
  message:
    "Trop de tentatives d'ajout de templates. Veuillez réessayer dans quelques minutes.",
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
  prefix: 'add_template',

  keyGenerator: (req) => {
    const ip = extractRealIp(req);
    return `add_template:ip:${ip}`;
  },
});

// Fonction d'invalidation du cache
const invalidateTemplatesCache = (requestId) => {
  try {
    const cacheKey = getDashboardCacheKey('templates_list', {
      endpoint: 'dashboard_templates',
      version: '1.0',
    });

    const cacheInvalidated = dashboardCache.templates.delete(cacheKey);

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

// Fonction pour créer les headers de réponse
const createResponseHeaders = (
  requestId,
  responseTime,
  rateLimitInfo = null,
) => {
  const headers = {
    'Access-Control-Allow-Origin':
      process.env.NEXT_PUBLIC_SITE_URL || 'same-origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-Requested-With',
    'Cache-Control':
      'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Resource-Policy': 'same-site',
    'Content-Security-Policy': "default-src 'none'; connect-src 'self'",
    'X-Request-ID': requestId,
    'X-Response-Time': `${responseTime}ms`,
    'X-API-Version': '1.0',
    'X-Transaction-Type': 'mutation',
    'X-Cache-Invalidation': 'templates',
    'X-RateLimit-Window': '300',
    'X-RateLimit-Limit': '10',
  };

  if (rateLimitInfo) {
    headers['X-RateLimit-Remaining'] =
      rateLimitInfo.remaining?.toString() || '0';
    headers['X-RateLimit-Reset'] = rateLimitInfo.resetTime?.toString() || '0';
  }

  return headers;
};

export async function POST(request) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();

  logger.info('Add Template API called', {
    requestId,
  });

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
    const rateLimitResponse = await addTemplateRateLimit(request);

    if (rateLimitResponse) {
      logger.warn('Add template API rate limit exceeded', {
        requestId,
        ip: anonymizeIp(extractRealIp(request)),
      });

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

      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(requestId, responseTime, {
        remaining: 0,
      });

      const rateLimitBody = await rateLimitResponse.json();
      return NextResponse.json(rateLimitBody, {
        status: 429,
        headers: headers,
      });
    }

    // ===== ÉTAPE 2: VÉRIFICATION AUTHENTIFICATION =====
    await isAuthenticatedUser(request, NextResponse);

    // ===== ÉTAPE 3: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Database Connection Error during template addition', {
        category: errorCategory,
        message: dbConnectionError.message,
        requestId,
      });

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
    } catch (parseError) {
      const errorCategory = categorizeError(parseError);

      logger.error('JSON Parse Error during template addition', {
        category: errorCategory,
        message: parseError.message,
        requestId,
      });

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

    // ===== ÉTAPE 5: SANITIZATION DES INPUTS =====
    const sanitizedInputs = sanitizeTemplateInputsStrict({
      templateName,
      templateImageId,
      templateHasWeb,
      templateHasMobile,
    });

    const {
      templateName: sanitizedTemplateName,
      templateImageId: sanitizedTemplateImageId,
      templateHasWeb: sanitizedTemplateHasWeb,
      templateHasMobile: sanitizedTemplateHasMobile,
    } = sanitizedInputs;

    // ===== ÉTAPE 6: VALIDATION AVEC YUP =====
    try {
      await templateAddingSchema.validate(
        {
          templateName: sanitizedTemplateName,
          templateImageId: sanitizedTemplateImageId,
          templateHasWeb: sanitizedTemplateHasWeb,
          templateHasMobile: sanitizedTemplateHasMobile,
        },
        { abortEarly: false },
      );
    } catch (validationError) {
      const errorCategory = categorizeError(validationError);

      logger.error('Template Validation Error with Yup', {
        category: errorCategory,
        failed_fields: validationError.inner?.map((err) => err.path) || [],
        total_errors: validationError.inner?.length || 0,
        requestId,
      });

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
          missingFields: {
            templateName: !sanitizedTemplateName,
            templateImageId: !sanitizedTemplateImageId,
          },
        },
      );

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

      result = await client.query(queryText, values);
    } catch (insertError) {
      const errorCategory = categorizeError(insertError);

      logger.error('Template Insertion Error', {
        category: errorCategory,
        message: insertError.message,
        requestId,
      });

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

    invalidateTemplatesCache(requestId);

    // ===== ÉTAPE 10: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Template addition successful', {
      newTemplateId,
      templateName: sanitizedTemplateName,
      response_time_ms: responseTime,
      success: true,
      requestId,
    });

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
      error_message: error.message,
      requestId,
    });

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
