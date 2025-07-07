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
// AJOUT POUR L'INVALIDATION DU CACHE
import { dashboardCache, getDashboardCacheKey } from '@/utils/cache';

// ----- CONFIGURATION DU RATE LIMITING POUR LA MODIFICATION DE PLATEFORMES -----

// Créer le middleware de rate limiting spécifique pour la modification de plateformes
const editPlatformRateLimit = applyRateLimit('CONTENT_API', {
  // Configuration personnalisée pour la modification de plateformes (plus restrictif car données sensibles)
  windowMs: 5 * 60 * 1000, // 5 minutes (plus restrictif que templates car données bancaires)
  max: 10, // 10 modifications par 5 minutes (plus restrictif que templates)
  message:
    'Trop de tentatives de modification de plateformes de paiement. Veuillez réessayer dans quelques minutes.',
  skipSuccessfulRequests: false, // Compter toutes les modifications réussies
  skipFailedRequests: false, // Compter aussi les échecs
  prefix: 'edit_platform', // Préfixe spécifique pour la modification de plateformes

  // Fonction personnalisée pour générer la clé (basée sur IP + ID de la plateforme)
  keyGenerator: (req) => {
    const ip = extractRealIp(req);
    const url = req.url || req.nextUrl?.pathname || '';
    const platformIdMatch = url.match(/platforms\/([^/]+)\/edit/);
    const platformId = platformIdMatch ? platformIdMatch[1] : 'unknown';
    return `edit_platform:ip:${ip}:platform:${platformId}`;
  },
});

// ----- FONCTION D'INVALIDATION DU CACHE -----
const invalidatePlatformsCache = (requestId, platformId) => {
  try {
    const cacheKey = getDashboardCacheKey('platforms_list', {
      endpoint: 'dashboard_platforms',
      version: '1.0',
    });

    const cacheInvalidated = dashboardCache.platforms.delete(cacheKey);

    logger.debug('Platforms cache invalidation', {
      requestId,
      platformId,
      component: 'platforms',
      action: 'cache_invalidation',
      operation: 'edit_platform',
      cacheKey,
      invalidated: cacheInvalidated,
    });

    // Capturer l'invalidation du cache avec Sentry
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
      component: 'platforms',
      action: 'cache_invalidation_failed',
      operation: 'edit_platform',
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

// ----- FONCTION UTILITAIRE POUR NETTOYER L'UUID -----
const cleanUUID = (uuid) => {
  if (!uuid || typeof uuid !== 'string') {
    return null;
  }

  // Nettoyer et normaliser l'UUID
  const cleaned = uuid.toLowerCase().trim();

  // Vérifier le format UUID
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
    // CORS spécifique pour mutations de plateformes (données sensibles)
    'Access-Control-Allow-Origin':
      process.env.NEXT_PUBLIC_SITE_URL || 'same-origin',
    'Access-Control-Allow-Methods': 'PUT, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-Requested-With',

    // Anti-cache ultra-strict pour données bancaires
    'Cache-Control':
      'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',

    // Sécurité renforcée pour données sensibles
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Resource-Policy': 'same-site',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',

    // Isolation renforcée pour données bancaires
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless',

    // CSP ultra-restrictive pour manipulation de données bancaires
    'Content-Security-Policy': "default-src 'none'; connect-src 'self'",

    // Headers de sécurité supplémentaires
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',

    // Headers de traçabilité
    'X-Request-ID': requestId,
    'X-Response-Time': `${responseTime}ms`,
    'X-API-Version': '1.0',

    // Headers spécifiques à l'édition de plateformes
    'X-Transaction-Type': 'mutation',
    'X-Operation-Type': 'update',
    'X-Entity-Type': 'platform',
    'X-Resource-ID': platformId,
    'X-Resource-Validation': 'platform-id',
    'X-Cache-Invalidation': 'platforms',
    'X-Data-Sensitivity': 'high',

    // Rate limiting spécifique aux plateformes (5 minutes / 10 max - plus restrictif)
    'X-RateLimit-Window': '300', // 5 minutes en secondes
    'X-RateLimit-Limit': '10',

    // Headers de validation et sécurité spécifiques
    'X-UUID-Validation': 'cleaned-and-verified',
    'X-Sanitization-Applied': 'true',
    'X-Yup-Validation-Applied': 'true',
    'X-Partial-Update': 'enabled',
    'X-Business-Rules': 'partial-update-allowed',

    // Headers de performance et monitoring
    'X-Database-Operations': '2', // connection + update (pas de uniqueness check)
    'X-Operation-Criticality': 'high',

    // Headers de sécurité pour données bancaires
    'X-Financial-Data': 'true',
    'X-PCI-Compliance': 'required',
    'X-Data-Masking': 'platform-number',

    // Headers anti-cache supplémentaires
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

export async function PUT(request, { params }) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();
  const { id } = params;

  logger.info('Edit Platform API called', {
    timestamp: new Date().toISOString(),
    requestId,
    platformId: id,
    component: 'platforms',
    action: 'api_start',
    method: 'PUT',
    operation: 'edit_platform',
  });

  // Capturer le début du processus de modification de plateforme
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
    logger.debug('Validating platform ID', {
      requestId,
      platformId: id,
      component: 'platforms',
      action: 'id_validation_start',
      operation: 'edit_platform',
    });

    try {
      await platformIdSchema.validate({ id }, { abortEarly: false });

      logger.debug('Platform ID validation passed', {
        requestId,
        platformId: id,
        component: 'platforms',
        action: 'id_validation_success',
        operation: 'edit_platform',
      });
    } catch (idValidationError) {
      const errorCategory = categorizeError(idValidationError);

      logger.error('Platform ID Validation Error', {
        category: errorCategory,
        platformId: id,
        validation_errors: idValidationError.inner?.map(
          (err) => err.message,
        ) || [idValidationError.message],
        requestId,
        component: 'platforms',
        action: 'id_validation_failed',
        operation: 'edit_platform',
      });

      // Capturer l'erreur de validation d'ID avec Sentry
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
        component: 'platforms',
        action: 'id_cleaning_failed',
        operation: 'edit_platform',
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
    logger.debug('Applying rate limiting for edit platform API', {
      requestId,
      platformId: cleanedPlatformId,
      component: 'platforms',
      action: 'rate_limit_start',
      operation: 'edit_platform',
    });

    const rateLimitResponse = await editPlatformRateLimit(request);

    // Si le rate limiter retourne une réponse, cela signifie que la limite est dépassée
    if (rateLimitResponse) {
      logger.warn('Edit platform API rate limit exceeded', {
        requestId,
        platformId: cleanedPlatformId,
        component: 'platforms',
        action: 'rate_limit_exceeded',
        operation: 'edit_platform',
        ip: anonymizeIp(extractRealIp(request)),
      });

      // Capturer l'événement de rate limiting avec Sentry
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

      // Ajouter les headers de sécurité même en cas de rate limit
      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(
        requestId,
        responseTime,
        cleanedPlatformId,
        {
          remaining: 0,
        },
      );

      // Modifier la réponse pour inclure nos headers
      const rateLimitBody = await rateLimitResponse.json();
      return NextResponse.json(rateLimitBody, {
        status: 429,
        headers: headers,
      });
    }

    logger.debug('Rate limiting passed successfully', {
      requestId,
      platformId: cleanedPlatformId,
      component: 'platforms',
      action: 'rate_limit_passed',
      operation: 'edit_platform',
    });

    // ===== ÉTAPE 3: VÉRIFICATION AUTHENTIFICATION =====
    logger.debug('Verifying user authentication', {
      requestId,
      platformId: cleanedPlatformId,
      component: 'platforms',
      action: 'auth_verification_start',
      operation: 'edit_platform',
    });

    await isAuthenticatedUser(request, NextResponse);

    logger.debug('User authentication verified successfully', {
      requestId,
      platformId: cleanedPlatformId,
      component: 'platforms',
      action: 'auth_verification_success',
      operation: 'edit_platform',
    });

    // ===== ÉTAPE 4: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
      logger.debug('Database connection successful', {
        requestId,
        platformId: cleanedPlatformId,
        component: 'platforms',
        action: 'db_connection_success',
        operation: 'edit_platform',
      });
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Database Connection Error during platform edit', {
        category: errorCategory,
        message: dbConnectionError.message,
        timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
        requestId,
        platformId: cleanedPlatformId,
        component: 'platforms',
        action: 'db_connection_failed',
        operation: 'edit_platform',
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
      logger.debug('Request body parsed successfully', {
        requestId,
        platformId: cleanedPlatformId,
        component: 'platforms',
        action: 'body_parse_success',
        operation: 'edit_platform',
      });
    } catch (parseError) {
      const errorCategory = categorizeError(parseError);

      logger.error('JSON Parse Error during platform edit', {
        category: errorCategory,
        message: parseError.message,
        requestId,
        platformId: cleanedPlatformId,
        component: 'platforms',
        action: 'json_parse_error',
        operation: 'edit_platform',
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

    logger.debug('Platform data extracted from request', {
      requestId,
      platformId: cleanedPlatformId,
      component: 'platforms',
      action: 'data_extraction',
      operation: 'edit_platform',
      hasPlatformName: !!platformName,
      hasPlatformNumber: !!platformNumber,
      hasIsActive: isActive !== undefined,
      // Ne pas logger les valeurs sensibles
      containsSensitiveData: true,
    });

    // ===== ÉTAPE 6: SANITIZATION DES INPUTS =====
    logger.debug('Sanitizing platform inputs', {
      requestId,
      platformId: cleanedPlatformId,
      component: 'platforms',
      action: 'input_sanitization',
      operation: 'edit_platform',
    });

    // Préparer les données pour la sanitization
    const dataToSanitize = {
      platformName,
      platformNumber,
      isActive,
    };

    // Filtrer les valeurs undefined pour la sanitization
    const filteredDataToSanitize = Object.fromEntries(
      Object.entries(dataToSanitize).filter(
        ([_, value]) => value !== undefined,
      ),
    );

    const sanitizedInputs = sanitizePlatformUpdateInputsStrict(
      filteredDataToSanitize,
    );

    // Récupérer les données sanitizées
    const {
      platformName: sanitizedPlatformName,
      platformNumber: sanitizedPlatformNumber,
      isActive: sanitizedIsActive,
    } = sanitizedInputs;

    logger.debug('Input sanitization completed', {
      requestId,
      platformId: cleanedPlatformId,
      component: 'platforms',
      action: 'input_sanitization_completed',
      operation: 'edit_platform',
      containsSensitiveData: true,
    });

    // ===== ÉTAPE 7: VALIDATION AVEC YUP =====
    try {
      // Filtrer les champs undefined pour la validation
      const dataToValidate = Object.fromEntries(
        Object.entries({
          platformName: sanitizedPlatformName,
          platformNumber: sanitizedPlatformNumber,
          isActive: sanitizedIsActive,
        }).filter(([_, value]) => value !== undefined),
      );

      // Valider les données avec le schema Yup pour les mises à jour
      await platformUpdateSchema.validate(dataToValidate, {
        abortEarly: false,
      });

      logger.debug('Platform validation with Yup passed', {
        requestId,
        platformId: cleanedPlatformId,
        component: 'platforms',
        action: 'yup_validation_success',
        operation: 'edit_platform',
      });
    } catch (validationError) {
      const errorCategory = categorizeError(validationError);

      logger.error('Platform Validation Error with Yup', {
        category: errorCategory,
        failed_fields: validationError.inner?.map((err) => err.path) || [],
        total_errors: validationError.inner?.length || 0,
        requestId,
        platformId: cleanedPlatformId,
        component: 'platforms',
        action: 'yup_validation_failed',
        operation: 'edit_platform',
      });

      // Capturer l'erreur de validation avec Sentry
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
    // Note: La vérification d'unicité a été commentée dans le code original
    let result;
    try {
      // Construire la requête dynamiquement selon les champs fournis
      const updateFields = [];
      const updateValues = [];
      let paramCounter = 1;

      if (sanitizedPlatformName !== undefined) {
        updateFields.push(`platform_name = ${paramCounter}`);
        updateValues.push(sanitizedPlatformName);
        paramCounter++;
      }

      if (sanitizedPlatformNumber !== undefined) {
        updateFields.push(`platform_number = ${paramCounter}`);
        updateValues.push(sanitizedPlatformNumber);
        paramCounter++;
      }

      if (sanitizedIsActive !== undefined) {
        updateFields.push(`is_active = ${paramCounter}`);
        updateValues.push(sanitizedIsActive);
        paramCounter++;
      }

      // Ajouter updated_at automatiquement
      updateFields.push(`updated_at = NOW()`);

      // Ajouter l'ID de la plateforme à la fin
      updateValues.push(cleanedPlatformId);

      const queryText = `
        UPDATE admin.platforms 
        SET ${updateFields.join(', ')}
        WHERE platform_id = ${cleanedPlatformId}
        RETURNING platform_id, platform_name, platform_number, is_active, created_at, updated_at
      `;

      console.log('Executing platform update query', {
        cleanedPlatformId,
        updateFields,
        updateValues,
      });

      console.log('Query Text:', queryText);

      logger.debug('Executing platform update query', {
        requestId,
        platformId: cleanedPlatformId,
        component: 'platforms',
        action: 'query_start',
        operation: 'edit_platform',
        table: 'admin.platforms',
        fieldsToUpdate: updateFields.length - 1, // -1 car updated_at est automatique
      });

      result = await client.query(queryText, updateValues);

      if (result.rows.length === 0) {
        logger.warn('Platform not found for update', {
          requestId,
          platformId: cleanedPlatformId,
          component: 'platforms',
          action: 'platform_not_found',
          operation: 'edit_platform',
        });

        // Capturer la plateforme non trouvée avec Sentry
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

      logger.debug('Platform update query executed successfully', {
        requestId,
        platformId: cleanedPlatformId,
        component: 'platforms',
        action: 'query_success',
        operation: 'edit_platform',
        updatedFields: updateFields.length - 1,
      });
    } catch (updateError) {
      const errorCategory = categorizeError(updateError);

      logger.error('Platform Update Error', {
        category: errorCategory,
        message: updateError.message,
        operation: 'UPDATE admin.platforms',
        table: 'admin.platforms',
        requestId,
        platformId: cleanedPlatformId,
        component: 'platforms',
        action: 'query_failed',
      });

      // Capturer l'erreur de mise à jour avec Sentry
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

    // Invalider le cache des plateformes après modification réussie
    invalidatePlatformsCache(requestId, cleanedPlatformId);

    // ===== ÉTAPE 10: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Platform update successful', {
      platformId: cleanedPlatformId,
      platformName: updatedPlatform.platform_name,
      response_time_ms: responseTime,
      database_operations: 2, // connection + update (pas de uniqueness check)
      cache_invalidated: true,
      success: true,
      requestId,
      component: 'platforms',
      action: 'update_success',
      entity: 'platform',
      rateLimitingApplied: true,
      operation: 'edit_platform',
      sanitizationApplied: true,
      yupValidationApplied: true,
      containsSensitiveData: true,
    });

    // Capturer le succès de la mise à jour avec Sentry
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
        containsSensitiveData: true,
      },
    });

    if (client) await client.cleanup();

    // Créer les headers de succès
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
      reached_global_handler: true,
      error_name: error.name,
      error_message: error.message,
      stack_available: !!error.stack,
      requestId,
      platformId: id,
      component: 'platforms',
      action: 'global_error_handler',
      entity: 'platform',
      operation: 'edit_platform',
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

    // Créer les headers même en cas d'erreur globale
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
