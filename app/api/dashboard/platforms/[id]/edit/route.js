/* eslint-disable no-unused-vars */
// app/api/dashboard/platforms/[id]/edit/route.js
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
import { sanitizePlatformUpdateInputsStrict } from '@/utils/sanitizers/sanitizePlatformInputs';
import {
  platformUpdateSchema,
  platformIdSchema,
} from '@/utils/schemas/platformSchema';
import { dashboardCache, getDashboardCacheKey } from '@/utils/cache';

// Créer le middleware de rate limiting spécifique pour la modification de plateformes
const editPlatformRateLimit = applyRateLimit('CONTENT_API', {
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // 10 modifications par 5 minutes
  message:
    'Trop de tentatives de modification de plateformes de paiement. Veuillez réessayer dans quelques minutes.',
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
  prefix: 'edit_platform',

  keyGenerator: (req) => {
    const ip = extractRealIp(req);
    const url = req.url || req.nextUrl?.pathname || '';
    const platformIdMatch = url.match(/platforms\/([^/]+)\/edit/);
    const platformId = platformIdMatch ? platformIdMatch[1] : 'unknown';
    return `edit_platform:ip:${ip}:platform:${platformId}`;
  },
});

// Fonction d'invalidation du cache
const invalidatePlatformsCache = (requestId, platformId) => {
  try {
    const cacheKey = getDashboardCacheKey('platforms_list', {
      endpoint: 'dashboard_platforms',
      version: '1.0',
    });

    const cacheInvalidated = dashboardCache.platforms.delete(cacheKey);

    captureMessage('Platforms cache invalidated after modification', {
      level: 'info',
      tags: {
        component: 'platforms',
        action: 'cache_invalidation',
        entity: 'platform',
        operation: 'update',
      },
      extra: {
        requestId,
        platformId,
        cacheKey,
        invalidated: cacheInvalidated,
      },
    });

    return cacheInvalidated;
  } catch (cacheError) {
    logger.warn('Failed to invalidate platforms cache', {
      requestId,
      platformId,
      error: cacheError.message,
    });

    captureException(cacheError, {
      level: 'warning',
      tags: {
        component: 'platforms',
        action: 'cache_invalidation_failed',
        error_category: 'cache',
        entity: 'platform',
        operation: 'update',
      },
      extra: {
        requestId,
        platformId,
      },
    });

    return false;
  }
};

// Fonction utilitaire pour nettoyer l'UUID
const cleanUUID = (uuid) => {
  if (!uuid || typeof uuid !== 'string') {
    return null;
  }

  const cleaned = uuid.toLowerCase().trim();
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  return uuidRegex.test(cleaned) ? cleaned : null;
};

const createResponseHeaders = (
  requestId,
  responseTime,
  platformId,
  rateLimitInfo = null,
) => {
  const headers = {
    'Access-Control-Allow-Origin':
      process.env.NEXT_PUBLIC_SITE_URL || 'same-origin',
    'Access-Control-Allow-Methods': 'PUT, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-Requested-With',
    'Cache-Control':
      'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Resource-Policy': 'same-site',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless',
    'Content-Security-Policy': "default-src 'none'; connect-src 'self'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'X-Request-ID': requestId,
    'X-Response-Time': `${responseTime}ms`,
    'X-API-Version': '1.0',
    'X-Transaction-Type': 'mutation',
    'X-Operation-Type': 'update',
    'X-Entity-Type': 'platform',
    'X-Resource-ID': platformId,
    'X-Cache-Invalidation': 'platforms',
    'X-RateLimit-Window': '300',
    'X-RateLimit-Limit': '10',
    'X-Sanitization-Applied': 'true',
    'X-Yup-Validation-Applied': 'true',
    'X-Database-Operations': '2',
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

export async function PUT(request, { params }) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();
  const { id } = params;

  logger.info('Edit Platform API called', {
    requestId,
    platformId: id,
  });

  captureMessage('Edit platform process started', {
    level: 'info',
    tags: {
      component: 'platforms',
      action: 'process_start',
      api_endpoint: '/api/dashboard/platforms/[id]/edit',
      entity: 'platform',
      operation: 'update',
    },
    extra: {
      requestId,
      platformId: id,
      timestamp: new Date().toISOString(),
      method: 'PUT',
    },
  });

  try {
    // ===== ÉTAPE 1: VALIDATION DE L'ID DE LA PLATEFORME =====
    try {
      await platformIdSchema.validate({ id }, { abortEarly: false });
    } catch (idValidationError) {
      const errorCategory = categorizeError(idValidationError);

      logger.error('Platform ID Validation Error', {
        category: errorCategory,
        platformId: id,
        validation_errors: idValidationError.inner?.map(
          (err) => err.message,
        ) || [idValidationError.message],
        requestId,
      });

      captureMessage('Platform ID validation failed', {
        level: 'warning',
        tags: {
          component: 'platforms',
          action: 'id_validation_failed',
          error_category: 'validation',
          entity: 'platform',
          operation: 'update',
        },
        extra: {
          requestId,
          platformId: id,
          validationErrors: idValidationError.inner?.map(
            (err) => err.message,
          ) || [idValidationError.message],
        },
      });

      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(requestId, responseTime, id);

      return NextResponse.json(
        {
          error: 'Invalid platform ID format',
          details: idValidationError.inner?.map((err) => err.message) || [
            idValidationError.message,
          ],
        },
        { status: 400, headers },
      );
    }

    // Nettoyer l'UUID pour garantir le format correct
    const cleanedPlatformId = cleanUUID(id);

    if (!cleanedPlatformId) {
      logger.warn('Platform ID cleaning failed', {
        requestId,
        providedId: id,
      });

      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(requestId, responseTime, id);

      return NextResponse.json(
        { error: 'Invalid platform ID format' },
        { status: 400, headers },
      );
    }

    // ===== ÉTAPE 2: APPLIQUER LE RATE LIMITING =====
    const rateLimitResponse = await editPlatformRateLimit(request);

    if (rateLimitResponse) {
      logger.warn('Edit platform API rate limit exceeded', {
        requestId,
        platformId: cleanedPlatformId,
        ip: anonymizeIp(extractRealIp(request)),
      });

      captureMessage('Edit platform API rate limit exceeded', {
        level: 'warning',
        tags: {
          component: 'platforms',
          action: 'rate_limit_exceeded',
          error_category: 'rate_limiting',
          entity: 'platform',
          operation: 'update',
        },
        extra: {
          requestId,
          platformId: cleanedPlatformId,
          ip: anonymizeIp(extractRealIp(request)),
          userAgent:
            request.headers.get('user-agent')?.substring(0, 100) || 'unknown',
        },
      });

      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(
        requestId,
        responseTime,
        cleanedPlatformId,
        {
          remaining: 0,
        },
      );

      const rateLimitBody = await rateLimitResponse.json();
      return NextResponse.json(rateLimitBody, {
        status: 429,
        headers: headers,
      });
    }

    // ===== ÉTAPE 3: VÉRIFICATION AUTHENTIFICATION =====
    await isAuthenticatedUser(request, NextResponse);

    // ===== ÉTAPE 4: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Database Connection Error during platform edit', {
        category: errorCategory,
        message: dbConnectionError.message,
        requestId,
        platformId: cleanedPlatformId,
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
          platformId: cleanedPlatformId,
          timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
          ip: anonymizeIp(extractRealIp(request)),
          rateLimitingApplied: true,
        },
      });

      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(
        requestId,
        responseTime,
        cleanedPlatformId,
      );

      return NextResponse.json(
        { error: 'Database connection failed' },
        { status: 503, headers },
      );
    }

    // ===== ÉTAPE 5: PARSING ET VALIDATION DU BODY =====
    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      const errorCategory = categorizeError(parseError);

      logger.error('JSON Parse Error during platform edit', {
        category: errorCategory,
        message: parseError.message,
        requestId,
        platformId: cleanedPlatformId,
      });

      captureException(parseError, {
        level: 'error',
        tags: {
          component: 'platforms',
          action: 'json_parse_error',
          error_category: categorizeError(parseError),
          operation: 'update',
        },
        extra: {
          requestId,
          platformId: cleanedPlatformId,
          contentType: request.headers.get('content-type'),
          userAgent: request.headers.get('user-agent')?.substring(0, 100),
        },
      });

      if (client) await client.cleanup();

      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(
        requestId,
        responseTime,
        cleanedPlatformId,
      );

      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400, headers },
      );
    }

    const { platformName, platformNumber, isActive } = body;

    // ===== ÉTAPE 6: SANITIZATION DES INPUTS =====
    const dataToSanitize = {
      platformName,
      platformNumber,
      isActive,
    };

    const filteredDataToSanitize = Object.fromEntries(
      Object.entries(dataToSanitize).filter(
        ([_, value]) => value !== undefined,
      ),
    );

    const sanitizedInputs = sanitizePlatformUpdateInputsStrict(
      filteredDataToSanitize,
    );

    const {
      platformName: sanitizedPlatformName,
      platformNumber: sanitizedPlatformNumber,
      isActive: sanitizedIsActive,
    } = sanitizedInputs;

    // ===== ÉTAPE 7: VALIDATION AVEC YUP =====
    try {
      const dataToValidate = Object.fromEntries(
        Object.entries({
          platformName: sanitizedPlatformName,
          platformNumber: sanitizedPlatformNumber,
          isActive: sanitizedIsActive,
        }).filter(([_, value]) => value !== undefined),
      );

      await platformUpdateSchema.validate(dataToValidate, {
        abortEarly: false,
      });
    } catch (validationError) {
      const errorCategory = categorizeError(validationError);

      logger.error('Platform Validation Error with Yup', {
        category: errorCategory,
        failed_fields: validationError.inner?.map((err) => err.path) || [],
        total_errors: validationError.inner?.length || 0,
        requestId,
        platformId: cleanedPlatformId,
      });

      captureMessage('Platform validation failed with Yup schema', {
        level: 'warning',
        tags: {
          component: 'platforms',
          action: 'yup_validation_failed',
          error_category: 'validation',
          entity: 'platform',
          operation: 'update',
        },
        extra: {
          requestId,
          platformId: cleanedPlatformId,
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
      const headers = createResponseHeaders(
        requestId,
        responseTime,
        cleanedPlatformId,
      );

      return NextResponse.json({ errors }, { status: 400, headers });
    }

    // ===== ÉTAPE 8: MISE À JOUR EN BASE DE DONNÉES =====
    let result;
    try {
      const updateFields = [];
      const updateValues = [];
      let paramCounter = 1;

      if (sanitizedPlatformName !== undefined) {
        updateFields.push(`platform_name = $${paramCounter}`);
        updateValues.push(sanitizedPlatformName);
        paramCounter++;
      }

      if (sanitizedPlatformNumber !== undefined) {
        updateFields.push(`platform_number = $${paramCounter}`);
        updateValues.push(sanitizedPlatformNumber);
        paramCounter++;
      }

      if (sanitizedIsActive !== undefined) {
        updateFields.push(`is_active = $${paramCounter}`);
        updateValues.push(sanitizedIsActive);
        paramCounter++;
      }

      updateFields.push(`updated_at = NOW()`);
      updateValues.push(cleanedPlatformId);

      const queryText = `
        UPDATE admin.platforms 
        SET ${updateFields.join(', ')}
        WHERE platform_id = $${paramCounter}
        RETURNING platform_id, platform_name, platform_number, is_active, created_at, updated_at
      `;

      result = await client.query(queryText, updateValues);

      if (result.rows.length === 0) {
        logger.warn('Platform not found for update', {
          requestId,
          platformId: cleanedPlatformId,
        });

        captureMessage('Platform not found for update', {
          level: 'warning',
          tags: {
            component: 'platforms',
            action: 'platform_not_found',
            error_category: 'not_found',
            entity: 'platform',
            operation: 'update',
          },
          extra: {
            requestId,
            platformId: cleanedPlatformId,
            ip: anonymizeIp(extractRealIp(request)),
          },
        });

        if (client) await client.cleanup();

        const responseTime = Date.now() - startTime;
        const headers = createResponseHeaders(
          requestId,
          responseTime,
          cleanedPlatformId,
        );

        return NextResponse.json(
          { message: 'Platform not found' },
          { status: 404, headers },
        );
      }
    } catch (updateError) {
      const errorCategory = categorizeError(updateError);

      logger.error('Platform Update Error', {
        category: errorCategory,
        message: updateError.message,
        requestId,
        platformId: cleanedPlatformId,
      });

      captureDatabaseError(updateError, {
        tags: {
          component: 'platforms',
          action: 'update_failed',
          operation: 'UPDATE',
          entity: 'platform',
        },
        extra: {
          requestId,
          platformId: cleanedPlatformId,
          table: 'admin.platforms',
          queryType: 'platform_update',
          postgresCode: updateError.code,
          postgresDetail: updateError.detail ? '[Filtered]' : undefined,
          ip: anonymizeIp(extractRealIp(request)),
          rateLimitingApplied: true,
        },
      });

      if (client) await client.cleanup();

      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(
        requestId,
        responseTime,
        cleanedPlatformId,
      );

      return NextResponse.json(
        { error: 'Failed to update platform', message: updateError.message },
        { status: 500, headers },
      );
    }

    // ===== ÉTAPE 9: INVALIDATION DU CACHE APRÈS SUCCÈS =====
    const updatedPlatform = result.rows[0];

    invalidatePlatformsCache(requestId, cleanedPlatformId);

    // ===== ÉTAPE 10: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Platform update successful', {
      platformId: cleanedPlatformId,
      platformName: updatedPlatform.platform_name,
      response_time_ms: responseTime,
      success: true,
      requestId,
    });

    captureMessage('Platform update completed successfully', {
      level: 'info',
      tags: {
        component: 'platforms',
        action: 'update_success',
        success: 'true',
        entity: 'platform',
        operation: 'update',
      },
      extra: {
        requestId,
        platformId: cleanedPlatformId,
        platformName: updatedPlatform.platform_name,
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

    const headers = createResponseHeaders(
      requestId,
      responseTime,
      cleanedPlatformId,
    );

    // Masquer partiellement le numéro dans la réponse pour sécurité
    const responseData = {
      ...updatedPlatform,
      platform_number: updatedPlatform.platform_number
        ? `${updatedPlatform.platform_number.slice(0, 3)}***${updatedPlatform.platform_number.slice(-2)}`
        : '[No Number]',
    };

    return NextResponse.json(
      {
        success: true,
        message: 'Platform updated successfully',
        platform: responseData,
        meta: {
          requestId,
          timestamp: new Date().toISOString(),
          security_note: 'Platform number is partially masked for security',
        },
      },
      {
        status: 200,
        headers: headers,
      },
    );
  } catch (error) {
    // ===== GESTION GLOBALE DES ERREURS =====
    const errorCategory = categorizeError(error);
    const responseTime = Date.now() - startTime;

    logger.error('Global Edit Platform Error', {
      category: errorCategory,
      response_time_ms: responseTime,
      error_message: error.message,
      requestId,
      platformId: id,
    });

    captureException(error, {
      level: 'error',
      tags: {
        component: 'platforms',
        action: 'global_error_handler',
        error_category: errorCategory,
        critical: 'true',
        entity: 'platform',
        operation: 'update',
      },
      extra: {
        requestId,
        platformId: id,
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'platform_update',
        ip: anonymizeIp(extractRealIp(request)),
        rateLimitingApplied: true,
      },
    });

    if (client) await client.cleanup();

    const headers = createResponseHeaders(requestId, responseTime, id);

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: 'Failed to update platform',
        requestId,
      },
      {
        status: 500,
        headers: headers,
      },
    );
  }
}
