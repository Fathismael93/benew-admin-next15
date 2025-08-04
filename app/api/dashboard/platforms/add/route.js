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
import { dashboardCache, getDashboardCacheKey } from '@/utils/cache';

// Créer le middleware de rate limiting spécifique pour l'ajout de plateformes
const addPlatformRateLimit = applyRateLimit('CONTENT_API', {
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5, // 5 ajouts par 10 minutes
  message:
    "Trop de tentatives d'ajout de plateformes de paiement. Veuillez réessayer dans quelques minutes.",
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
  prefix: 'add_platform',

  keyGenerator: (req) => {
    const ip = extractRealIp(req);
    return `add_platform:ip:${ip}`;
  },
});

// Fonction d'invalidation du cache
const invalidatePlatformsCache = (requestId) => {
  try {
    const cacheKey = getDashboardCacheKey('platforms_list', {
      endpoint: 'dashboard_platforms',
      version: '1.0',
    });

    const cacheInvalidated = dashboardCache.platforms.delete(cacheKey);

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
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless',
    'Cross-Origin-Resource-Policy': 'same-site',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'none'; connect-src 'self'",
    'X-RateLimit-Window': '600',
    'X-RateLimit-Limit': '5',
    'X-Cache-Invalidation': 'platforms',
    'X-Database-Operations': '3',
    'X-Request-ID': requestId,
    'X-Response-Time': `${responseTime}ms`,
    'X-API-Version': '1.0',
    'X-Transaction-Type': 'mutation',
    'X-Entity-Type': 'platform',
    'X-Operation-Type': 'create',
    'X-Sanitization-Applied': 'true',
    'X-Yup-Validation-Applied': 'true',
    'X-Uniqueness-Check-Applied': 'true',
    Vary: 'Authorization, Content-Type',
    'X-Permitted-Cross-Domain-Policies': 'none',
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

  logger.info('Add Platform API called', {
    requestId,
  });

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
    const rateLimitResponse = await addPlatformRateLimit(request);

    if (rateLimitResponse) {
      logger.warn('Add platform API rate limit exceeded', {
        requestId,
        ip: anonymizeIp(extractRealIp(request)),
      });

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

      logger.error('Database Connection Error during platform addition', {
        category: errorCategory,
        message: dbConnectionError.message,
        requestId,
      });

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
    } catch (parseError) {
      const errorCategory = categorizeError(parseError);

      logger.error('JSON Parse Error during platform addition', {
        category: errorCategory,
        message: parseError.message,
        requestId,
      });

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

    // ===== ÉTAPE 5: SANITIZATION DES INPUTS =====
    const sanitizedInputs = sanitizePlatformInputsStrict({
      platformName,
      platformNumber,
    });

    const {
      platformName: sanitizedPlatformName,
      platformNumber: sanitizedPlatformNumber,
    } = sanitizedInputs;

    // ===== ÉTAPE 6: VALIDATION AVEC YUP =====
    try {
      await platformAddingSchema.validate(
        {
          platformName: sanitizedPlatformName,
          platformNumber: sanitizedPlatformNumber,
        },
        { abortEarly: false },
      );
    } catch (validationError) {
      const errorCategory = categorizeError(validationError);

      logger.error('Platform Validation Error with Yup', {
        category: errorCategory,
        failed_fields: validationError.inner?.map((err) => err.path) || [],
        total_errors: validationError.inner?.length || 0,
        requestId,
      });

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
          missingFields: {
            platformName: !sanitizedPlatformName,
            platformNumber: !sanitizedPlatformNumber,
          },
        },
      );

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

    // ===== ÉTAPE 8: VÉRIFICATION DE L'UNICITÉ =====
    let existingPlatform;
    try {
      const uniqueCheckQuery = `
        SELECT platform_id, platform_name, platform_number 
        FROM admin.platforms 
        WHERE LOWER(platform_name) = LOWER($1)
      `;

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
          duplicateField,
          existingPlatformId: existingPlatform.rows[0].platform_id,
        });

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
    } catch (uniqueCheckError) {
      const errorCategory = categorizeError(uniqueCheckError);

      logger.error('Platform Uniqueness Check Error', {
        category: errorCategory,
        message: uniqueCheckError.message,
        requestId,
      });

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

      result = await client.query(queryText, values);
    } catch (insertError) {
      const errorCategory = categorizeError(insertError);

      logger.error('Platform Insertion Error', {
        category: errorCategory,
        message: insertError.message,
        requestId,
      });

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

    invalidatePlatformsCache(requestId);

    // ===== ÉTAPE 11: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Platform addition successful', {
      newPlatformId: newPlatformData.platform_id,
      platformName: sanitizedPlatformName,
      response_time_ms: responseTime,
      success: true,
      requestId,
    });

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
      error_message: error.message,
      requestId,
    });

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
