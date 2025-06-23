// app/api/dashboard/platforms/[id]/route.js
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
import { platformIdSchema } from '@/utils/schemas/platformSchema';

// ----- CONFIGURATION DU RATE LIMITING POUR LA RÉCUPÉRATION D'UNE PLATEFORME -----

// Créer le middleware de rate limiting spécifique pour la récupération d'une plateforme
const getPlatformByIdRateLimit = applyRateLimit('AUTHENTICATED_API', {
  // Configuration personnalisée pour la récupération d'une plateforme (plus restrictif car données sensibles)
  windowMs: 2 * 60 * 1000, // 2 minutes (plus restrictif que templates)
  max: 40, // 40 requêtes par 2 minutes (moins que templates car données bancaires)
  message:
    'Trop de requêtes pour récupérer des plateformes de paiement. Veuillez réessayer dans quelques instants.',
  skipSuccessfulRequests: false, // Compter toutes les requêtes réussies
  skipFailedRequests: false, // Compter aussi les échecs
  prefix: 'get_platform_by_id', // Préfixe spécifique pour la récupération d'une plateforme

  // Fonction personnalisée pour générer la clé (basée sur IP)
  keyGenerator: (req) => {
    const ip = extractRealIp(req);
    return `get_platform_by_id:ip:${ip}`;
  },
});

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

// ----- API ROUTE PRINCIPALE AVEC RATE LIMITING ET MONITORING SENTRY -----

export async function GET(req, { params }) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();
  const { id } = params;

  logger.info('Get Platform By ID API called', {
    timestamp: new Date().toISOString(),
    requestId,
    component: 'platforms',
    action: 'api_start',
    method: 'GET',
    operation: 'get_platform_by_id',
    platformId: id,
  });

  // Capturer le début du processus de récupération d'une plateforme
  captureMessage('Get platform by ID process started', {
    level: 'info',
    tags: {
      component: 'platforms',
      action: 'process_start',
      api_endpoint: '/api/dashboard/platforms/[id]',
      entity: 'platform',
      operation: 'read',
    },
    extra: {
      requestId,
      platformId: id,
      timestamp: new Date().toISOString(),
      method: 'GET',
    },
  });

  try {
    // ===== ÉTAPE 1: APPLIQUER LE RATE LIMITING =====
    logger.debug('Applying rate limiting for get platform by ID API', {
      requestId,
      component: 'platforms',
      action: 'rate_limit_start',
      operation: 'get_platform_by_id',
      platformId: id,
    });

    const rateLimitResponse = await getPlatformByIdRateLimit(req);

    // Si le rate limiter retourne une réponse, cela signifie que la limite est dépassée
    if (rateLimitResponse) {
      logger.warn('Get platform by ID API rate limit exceeded', {
        requestId,
        component: 'platforms',
        action: 'rate_limit_exceeded',
        operation: 'get_platform_by_id',
        platformId: id,
        ip: anonymizeIp(extractRealIp(req)),
      });

      // Capturer l'événement de rate limiting avec Sentry
      captureMessage('Get platform by ID API rate limit exceeded', {
        level: 'warning',
        tags: {
          component: 'platforms',
          action: 'rate_limit_exceeded',
          error_category: 'rate_limiting',
          entity: 'platform',
          operation: 'read',
        },
        extra: {
          requestId,
          platformId: id,
          ip: anonymizeIp(extractRealIp(req)),
          userAgent:
            req.headers.get('user-agent')?.substring(0, 100) || 'unknown',
        },
      });

      return rateLimitResponse; // Retourner directement la réponse 429
    }

    logger.debug('Rate limiting passed successfully', {
      requestId,
      component: 'platforms',
      action: 'rate_limit_passed',
      operation: 'get_platform_by_id',
      platformId: id,
    });

    // ===== ÉTAPE 2: VÉRIFICATION AUTHENTIFICATION =====
    logger.debug('Verifying user authentication', {
      requestId,
      component: 'platforms',
      action: 'auth_verification_start',
      operation: 'get_platform_by_id',
      platformId: id,
    });

    await isAuthenticatedUser(req, NextResponse);

    logger.debug('User authentication verified successfully', {
      requestId,
      component: 'platforms',
      action: 'auth_verification_success',
      operation: 'get_platform_by_id',
      platformId: id,
    });

    // ===== ÉTAPE 3: VALIDATION DE L'ID AVEC YUP =====
    logger.debug('Validating platform ID with Yup schema', {
      requestId,
      component: 'platforms',
      action: 'id_validation_start',
      operation: 'get_platform_by_id',
      providedId: id,
    });

    try {
      // Valider l'ID avec le schema Yup
      await platformIdSchema.validate({ id }, { abortEarly: false });

      logger.debug('Platform ID validation with Yup passed', {
        requestId,
        component: 'platforms',
        action: 'yup_id_validation_success',
        operation: 'get_platform_by_id',
        platformId: id,
      });
    } catch (validationError) {
      const errorCategory = categorizeError(validationError);

      logger.warn('Platform ID validation failed with Yup', {
        category: errorCategory,
        providedId: id,
        failed_fields: validationError.inner?.map((err) => err.path) || [],
        total_errors: validationError.inner?.length || 0,
        requestId,
        component: 'platforms',
        action: 'yup_id_validation_failed',
        operation: 'get_platform_by_id',
      });

      // Capturer l'erreur de validation avec Sentry
      captureMessage('Platform ID validation failed with Yup schema', {
        level: 'warning',
        tags: {
          component: 'platforms',
          action: 'yup_id_validation_failed',
          error_category: 'validation',
          entity: 'platform',
          operation: 'read',
        },
        extra: {
          requestId,
          providedId: id,
          failedFields: validationError.inner?.map((err) => err.path) || [],
          totalErrors: validationError.inner?.length || 0,
          validationErrors:
            validationError.inner?.map((err) => ({
              field: err.path,
              message: err.message,
            })) || [],
          ip: anonymizeIp(extractRealIp(req)),
        },
      });

      const errors = {};
      validationError.inner.forEach((error) => {
        errors[error.path] = error.message;
      });

      return NextResponse.json({ errors }, { status: 400 });
    }

    // Nettoyer l'UUID pour garantir le format correct
    const cleanedPlatformId = cleanUUID(id);
    if (!cleanedPlatformId) {
      logger.warn('Platform ID cleaning failed', {
        requestId,
        component: 'platforms',
        action: 'id_cleaning_failed',
        operation: 'get_platform_by_id',
        providedId: id,
      });

      return NextResponse.json(
        { error: 'Invalid platform ID format' },
        { status: 400 },
      );
    }

    logger.debug('Platform ID validation and cleaning passed', {
      requestId,
      component: 'platforms',
      action: 'id_validation_success',
      operation: 'get_platform_by_id',
      originalId: id,
      cleanedId: cleanedPlatformId,
    });

    // ===== ÉTAPE 4: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
      logger.debug('Database connection successful', {
        requestId,
        component: 'platforms',
        action: 'db_connection_success',
        operation: 'get_platform_by_id',
        platformId: cleanedPlatformId,
      });
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Database Connection Error during platform fetch by ID', {
        category: errorCategory,
        message: dbConnectionError.message,
        timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
        requestId,
        component: 'platforms',
        action: 'db_connection_failed',
        operation: 'get_platform_by_id',
        platformId: cleanedPlatformId,
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
          ip: anonymizeIp(extractRealIp(req)),
          rateLimitingApplied: true,
        },
      });

      return NextResponse.json(
        { error: 'Database connection failed' },
        { status: 503 },
      );
    }

    // ===== ÉTAPE 5: EXÉCUTION DE LA REQUÊTE =====
    let result;
    try {
      const platformQuery = `
        SELECT 
          platform_id,
          platform_name,
          platform_number,
          created_at,
          updated_at,
          is_active
        FROM admin.platforms 
        WHERE platform_id = $1
      `;

      logger.debug('Executing platform fetch by ID query', {
        requestId,
        component: 'platforms',
        action: 'query_start',
        operation: 'get_platform_by_id',
        platformId: cleanedPlatformId,
        table: 'admin.platforms',
      });

      result = await client.query(platformQuery, [cleanedPlatformId]);

      logger.debug('Platform fetch by ID query executed successfully', {
        requestId,
        component: 'platforms',
        action: 'query_success',
        operation: 'get_platform_by_id',
        platformId: cleanedPlatformId,
        rowCount: result.rows.length,
      });
    } catch (queryError) {
      const errorCategory = categorizeError(queryError);

      logger.error('Platform Fetch By ID Query Error', {
        category: errorCategory,
        message: queryError.message,
        query: 'platform_fetch_by_id',
        table: 'admin.platforms',
        platformId: cleanedPlatformId,
        requestId,
        component: 'platforms',
        action: 'query_failed',
        operation: 'get_platform_by_id',
      });

      // Capturer l'erreur de requête avec Sentry
      captureDatabaseError(queryError, {
        tags: {
          component: 'platforms',
          action: 'query_failed',
          operation: 'SELECT',
          entity: 'platform',
        },
        extra: {
          requestId,
          platformId: cleanedPlatformId,
          table: 'admin.platforms',
          queryType: 'platform_fetch_by_id',
          postgresCode: queryError.code,
          postgresDetail: queryError.detail ? '[Filtered]' : undefined,
          ip: anonymizeIp(extractRealIp(req)),
          rateLimitingApplied: true,
        },
      });

      if (client) await client.cleanup();
      return NextResponse.json(
        { error: 'Failed to fetch platform from database' },
        { status: 500 },
      );
    }

    // ===== ÉTAPE 6: VÉRIFICATION EXISTENCE DE LA PLATEFORME =====
    if (result.rows.length === 0) {
      logger.warn('Platform not found', {
        requestId,
        component: 'platforms',
        action: 'platform_not_found',
        operation: 'get_platform_by_id',
        platformId: cleanedPlatformId,
      });

      // Capturer la plateforme non trouvée avec Sentry
      captureMessage('Platform not found', {
        level: 'warning',
        tags: {
          component: 'platforms',
          action: 'platform_not_found',
          error_category: 'business_logic',
          entity: 'platform',
          operation: 'read',
        },
        extra: {
          requestId,
          platformId: cleanedPlatformId,
          ip: anonymizeIp(extractRealIp(req)),
        },
      });

      if (client) await client.cleanup();
      return NextResponse.json(
        { message: 'Platform not found' },
        { status: 404 },
      );
    }

    // ===== ÉTAPE 7: FORMATAGE DES DONNÉES =====
    const platform = result.rows[0];
    const sanitizedPlatform = {
      platform_id: platform.platform_id,
      platform_name: platform.platform_name || '[No Name]',
      // Pour l'API d'édition, on retourne le numéro complet (nécessaire pour le formulaire)
      // Mais on le marque comme sensible dans les logs
      platform_number: platform.platform_number || '[No Number]',
      created_at: platform.created_at,
      updated_at: platform.updated_at,
      is_active: Boolean(platform.is_active),
    };

    logger.debug('Platform data sanitized', {
      requestId,
      component: 'platforms',
      action: 'data_sanitization',
      operation: 'get_platform_by_id',
      platformId: cleanedPlatformId,
      // Ne pas logger le numéro complet pour sécurité
      containsSensitiveData: true,
    });

    // ===== ÉTAPE 8: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Platform fetch by ID successful', {
      platformId: cleanedPlatformId,
      platformName: sanitizedPlatform.platform_name,
      response_time_ms: responseTime,
      database_operations: 2, // connection + query
      success: true,
      requestId,
      component: 'platforms',
      action: 'fetch_by_id_success',
      entity: 'platform',
      rateLimitingApplied: true,
      operation: 'get_platform_by_id',
      yupValidationApplied: true,
      containsSensitiveData: true,
    });

    // Capturer le succès de la récupération avec Sentry
    captureMessage('Platform fetch by ID completed successfully', {
      level: 'info',
      tags: {
        component: 'platforms',
        action: 'fetch_by_id_success',
        success: 'true',
        entity: 'platform',
        operation: 'read',
      },
      extra: {
        requestId,
        platformId: cleanedPlatformId,
        platformName: sanitizedPlatform.platform_name,
        responseTimeMs: responseTime,
        databaseOperations: 2,
        ip: anonymizeIp(extractRealIp(req)),
        rateLimitingApplied: true,
        containsSensitiveData: true,
      },
    });

    if (client) await client.cleanup();

    return NextResponse.json(
      {
        platform: sanitizedPlatform,
        meta: {
          requestId,
          timestamp: new Date().toISOString(),
          security_note:
            'Platform number is included for editing purposes - handle with care',
        },
      },
      {
        status: 200,
        headers: {
          'X-Request-ID': requestId,
          'X-Response-Time': `${responseTime}ms`,
        },
      },
    );
  } catch (error) {
    // ===== GESTION GLOBALE DES ERREURS =====
    const errorCategory = categorizeError(error);
    const responseTime = Date.now() - startTime;

    logger.error('Global Get Platform By ID Error', {
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
      operation: 'get_platform_by_id',
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
        operation: 'read',
      },
      extra: {
        requestId,
        platformId: id,
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'platform_fetch_by_id',
        ip: anonymizeIp(extractRealIp(req)),
        rateLimitingApplied: true,
      },
    });

    if (client) await client.cleanup();

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: 'Failed to fetch platform',
        requestId,
      },
      {
        status: 500,
        headers: {
          'X-Request-ID': requestId,
          'X-Response-Time': `${responseTime}ms`,
        },
      },
    );
  }
}
