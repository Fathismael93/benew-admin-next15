// app/api/dashboard/platforms/[id]/delete/route.js
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
// AJOUT POUR L'INVALIDATION DU CACHE
import { dashboardCache, getDashboardCacheKey } from '@/utils/cache';

export const dynamic = 'force-dynamic';

// ----- CONFIGURATION DU RATE LIMITING POUR LA SUPPRESSION DE PLATEFORMES -----

// Créer le middleware de rate limiting spécifique pour la suppression de plateformes
const deletePlatformRateLimit = applyRateLimit('CONTENT_API', {
  // Configuration personnalisée pour la suppression de plateformes (très restrictif car données bancaires critiques)
  windowMs: 10 * 60 * 1000, // 10 minutes (plus strict que templates car données bancaires)
  max: 5, // 5 suppressions par 10 minutes (très restrictif pour sécurité financière)
  message:
    'Trop de tentatives de suppression de plateformes de paiement. Veuillez réessayer dans quelques minutes.',
  skipSuccessfulRequests: false, // Compter toutes les suppressions réussies
  skipFailedRequests: false, // Compter aussi les échecs
  prefix: 'delete_platform', // Préfixe spécifique pour la suppression de plateformes

  // Fonction personnalisée pour générer la clé (basée sur IP + ID de la plateforme)
  keyGenerator: (req) => {
    const ip = extractRealIp(req);
    const url = req.url || req.nextUrl?.pathname || '';
    const platformIdMatch = url.match(/platforms\/([^/]+)\/delete/);
    const platformId = platformIdMatch ? platformIdMatch[1] : 'unknown';
    return `delete_platform:ip:${ip}:platform:${platformId}`;
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
      operation: 'delete_platform',
      cacheKey,
      invalidated: cacheInvalidated,
    });

    // Capturer l'invalidation du cache avec Sentry
    captureMessage('Platforms cache invalidated after deletion', {
      level: 'info',
      tags: {
        component: 'platforms',
        action: 'cache_invalidation',
        entity: 'platform',
        operation: 'delete',
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
      operation: 'delete_platform',
      error: cacheError.message,
    });

    captureException(cacheError, {
      level: 'warning',
      tags: {
        component: 'platforms',
        action: 'cache_invalidation_failed',
        error_category: 'cache',
        entity: 'platform',
        operation: 'delete',
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

// ----- API ROUTE PRINCIPALE AVEC RATE LIMITING -----

export async function DELETE(request, { params }) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();
  const { id } = params;

  logger.info('Delete Platform API called', {
    timestamp: new Date().toISOString(),
    requestId,
    platformId: id,
    component: 'platforms',
    action: 'api_start',
    method: 'DELETE',
    operation: 'delete_platform',
  });

  // Capturer le début du processus de suppression de plateforme
  captureMessage('Delete platform process started', {
    level: 'info',
    tags: {
      component: 'platforms',
      action: 'process_start',
      api_endpoint: '/api/dashboard/platforms/[id]/delete',
      entity: 'platform',
      operation: 'delete',
    },
    extra: {
      requestId,
      platformId: id,
      timestamp: new Date().toISOString(),
      method: 'DELETE',
    },
  });

  try {
    // ===== ÉTAPE 1: VALIDATION DE L'ID DE LA PLATEFORME =====
    logger.debug('Validating platform ID', {
      requestId,
      platformId: id,
      component: 'platforms',
      action: 'id_validation_start',
      operation: 'delete_platform',
    });

    try {
      await platformIdSchema.validate({ id }, { abortEarly: false });

      logger.debug('Platform ID validation passed', {
        requestId,
        platformId: id,
        component: 'platforms',
        action: 'id_validation_success',
        operation: 'delete_platform',
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
        operation: 'delete_platform',
      });

      // Capturer l'erreur de validation d'ID avec Sentry
      captureMessage('Platform ID validation failed', {
        level: 'warning',
        tags: {
          component: 'platforms',
          action: 'id_validation_failed',
          error_category: 'validation',
          entity: 'platform',
          operation: 'delete',
        },
        extra: {
          requestId,
          platformId: id,
          validationErrors: idValidationError.inner?.map(
            (err) => err.message,
          ) || [idValidationError.message],
        },
      });

      return NextResponse.json(
        {
          success: false,
          error: 'Invalid platform ID format',
          message: 'This platform does not exist',
          details: idValidationError.inner?.map((err) => err.message) || [
            idValidationError.message,
          ],
        },
        { status: 400 },
      );
    }

    // Nettoyer l'UUID pour garantir le format correct
    const cleanedPlatformId = cleanUUID(id);
    if (!cleanedPlatformId) {
      logger.warn('Platform ID cleaning failed', {
        requestId,
        component: 'platforms',
        action: 'id_cleaning_failed',
        operation: 'delete_platform',
        providedId: id,
      });

      return NextResponse.json(
        {
          success: false,
          error: 'Invalid platform ID format',
          message: 'This platform does not exist',
        },
        { status: 400 },
      );
    }

    // ===== ÉTAPE 2: APPLIQUER LE RATE LIMITING =====
    logger.debug('Applying rate limiting for delete platform API', {
      requestId,
      platformId: cleanedPlatformId,
      component: 'platforms',
      action: 'rate_limit_start',
      operation: 'delete_platform',
    });

    const rateLimitResponse = await deletePlatformRateLimit(request);

    // Si le rate limiter retourne une réponse, cela signifie que la limite est dépassée
    if (rateLimitResponse) {
      logger.warn('Delete platform API rate limit exceeded', {
        requestId,
        platformId: cleanedPlatformId,
        component: 'platforms',
        action: 'rate_limit_exceeded',
        operation: 'delete_platform',
        ip: anonymizeIp(extractRealIp(request)),
      });

      // Capturer l'événement de rate limiting avec Sentry
      captureMessage('Delete platform API rate limit exceeded', {
        level: 'warning',
        tags: {
          component: 'platforms',
          action: 'rate_limit_exceeded',
          error_category: 'rate_limiting',
          entity: 'platform',
          operation: 'delete',
        },
        extra: {
          requestId,
          platformId: cleanedPlatformId,
          ip: anonymizeIp(extractRealIp(request)),
          userAgent:
            request.headers.get('user-agent')?.substring(0, 100) || 'unknown',
        },
      });

      return rateLimitResponse; // Retourner directement la réponse 429
    }

    logger.debug('Rate limiting passed successfully', {
      requestId,
      platformId: cleanedPlatformId,
      component: 'platforms',
      action: 'rate_limit_passed',
      operation: 'delete_platform',
    });

    // ===== ÉTAPE 3: VÉRIFICATION AUTHENTIFICATION =====
    logger.debug('Verifying user authentication', {
      requestId,
      platformId: cleanedPlatformId,
      component: 'platforms',
      action: 'auth_verification_start',
      operation: 'delete_platform',
    });

    await isAuthenticatedUser(request, NextResponse);

    logger.debug('User authentication verified successfully', {
      requestId,
      platformId: cleanedPlatformId,
      component: 'platforms',
      action: 'auth_verification_success',
      operation: 'delete_platform',
    });

    // ===== ÉTAPE 4: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
      logger.debug('Database connection successful', {
        requestId,
        platformId: cleanedPlatformId,
        component: 'platforms',
        action: 'db_connection_success',
        operation: 'delete_platform',
      });
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Database Connection Error during platform deletion', {
        category: errorCategory,
        message: dbConnectionError.message,
        timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
        requestId,
        platformId: cleanedPlatformId,
        component: 'platforms',
        action: 'db_connection_failed',
        operation: 'delete_platform',
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

      return NextResponse.json(
        {
          success: false,
          error: 'Database connection failed',
        },
        { status: 503 },
      );
    }

    // ===== ÉTAPE 5: VÉRIFICATION DE L'EXISTENCE ET DE L'ÉTAT DE LA PLATEFORME =====
    let platformToDelete;
    try {
      logger.debug('Checking platform existence and status', {
        requestId,
        platformId: cleanedPlatformId,
        component: 'platforms',
        action: 'platform_check_start',
        operation: 'delete_platform',
      });

      const checkResult = await client.query(
        `SELECT platform_id, platform_name, platform_number, is_active, created_at, updated_at 
         FROM admin.platforms 
         WHERE platform_id = $1`,
        [cleanedPlatformId],
      );

      if (checkResult.rows.length === 0) {
        logger.warn('Platform not found for deletion', {
          requestId,
          platformId: cleanedPlatformId,
          component: 'platforms',
          action: 'platform_not_found',
          operation: 'delete_platform',
        });

        // Capturer la plateforme non trouvée avec Sentry
        captureMessage('Platform not found for deletion', {
          level: 'warning',
          tags: {
            component: 'platforms',
            action: 'platform_not_found',
            error_category: 'not_found',
            entity: 'platform',
            operation: 'delete',
          },
          extra: {
            requestId,
            platformId: cleanedPlatformId,
            ip: anonymizeIp(extractRealIp(request)),
          },
        });

        if (client) await client.cleanup();
        return NextResponse.json(
          {
            success: false,
            message: 'This platform does not exist',
          },
          { status: 404 },
        );
      }

      platformToDelete = checkResult.rows[0];

      // Vérifier que la plateforme est inactive (condition obligatoire pour la suppression)
      if (platformToDelete.is_active === true) {
        logger.warn('Attempted to delete active platform', {
          requestId,
          platformId: cleanedPlatformId,
          platformName: platformToDelete.platform_name,
          isActive: platformToDelete.is_active,
          component: 'platforms',
          action: 'active_platform_deletion_blocked',
          operation: 'delete_platform',
          containsSensitiveData: true,
        });

        // Capturer la tentative de suppression d'une plateforme active avec Sentry
        captureMessage('Attempted to delete active platform', {
          level: 'warning',
          tags: {
            component: 'platforms',
            action: 'active_platform_deletion_blocked',
            error_category: 'business_rule_violation',
            entity: 'platform',
            operation: 'delete',
          },
          extra: {
            requestId,
            platformId: cleanedPlatformId,
            platformName: platformToDelete.platform_name,
            isActive: platformToDelete.is_active,
            ip: anonymizeIp(extractRealIp(request)),
            containsSensitiveData: true,
          },
        });

        if (client) await client.cleanup();
        return NextResponse.json(
          {
            success: false,
            message:
              'Cannot delete active platform. Please deactivate the platform first.',
            error: 'Platform is currently active',
          },
          { status: 400 },
        );
      }

      logger.debug('Platform validation passed - inactive platform found', {
        requestId,
        platformId: cleanedPlatformId,
        platformName: platformToDelete.platform_name,
        isActive: platformToDelete.is_active,
        component: 'platforms',
        action: 'platform_check_success',
        operation: 'delete_platform',
        containsSensitiveData: true,
      });
    } catch (checkError) {
      const errorCategory = categorizeError(checkError);

      logger.error('Platform Check Error', {
        category: errorCategory,
        message: checkError.message,
        requestId,
        platformId: cleanedPlatformId,
        component: 'platforms',
        action: 'platform_check_failed',
        operation: 'delete_platform',
      });

      // Capturer l'erreur de vérification avec Sentry
      captureDatabaseError(checkError, {
        tags: {
          component: 'platforms',
          action: 'platform_check_failed',
          operation: 'SELECT',
          entity: 'platform',
        },
        extra: {
          requestId,
          platformId: cleanedPlatformId,
          table: 'admin.platforms',
          queryType: 'platform_existence_check',
          postgresCode: checkError.code,
          ip: anonymizeIp(extractRealIp(request)),
        },
      });

      if (client) await client.cleanup();
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to verify platform status',
          message: 'Something went wrong! Please try again',
        },
        { status: 500 },
      );
    }

    // ===== ÉTAPE 6: VÉRIFICATION DES DÉPENDANCES (transactions actives, etc.) =====
    try {
      logger.debug('Checking platform dependencies before deletion', {
        requestId,
        platformId: cleanedPlatformId,
        component: 'platforms',
        action: 'dependencies_check_start',
        operation: 'delete_platform',
      });

      // Vérifier s'il y a des commandes ou transactions liées à cette plateforme
      // (Adaptez cette requête selon votre schéma de base de données)
      const dependenciesCheck = await client.query(
        `SELECT COUNT(*) as transaction_count 
         FROM admin.orders 
         WHERE order_platform_id = $1 
         AND order_payment_status IN ('pending', 'processing', 'completed')`,
        [cleanedPlatformId],
      );

      const transactionCount =
        parseInt(dependenciesCheck.rows[0].transaction_count) || 0;

      if (transactionCount > 0) {
        logger.warn('Platform has active transactions - deletion blocked', {
          requestId,
          platformId: cleanedPlatformId,
          platformName: platformToDelete.platform_name,
          transactionCount,
          component: 'platforms',
          action: 'dependencies_found',
          operation: 'delete_platform',
        });

        // Capturer la tentative de suppression d'une plateforme avec dépendances
        captureMessage('Platform deletion blocked due to active transactions', {
          level: 'warning',
          tags: {
            component: 'platforms',
            action: 'dependencies_found',
            error_category: 'business_rule_violation',
            entity: 'platform',
            operation: 'delete',
          },
          extra: {
            requestId,
            platformId: cleanedPlatformId,
            platformName: platformToDelete.platform_name,
            transactionCount,
            ip: anonymizeIp(extractRealIp(request)),
          },
        });

        if (client) await client.cleanup();
        return NextResponse.json(
          {
            success: false,
            message: `Cannot delete platform. It has ${transactionCount} associated transaction(s). Please resolve all transactions first.`,
            error: 'Platform has active dependencies',
            details: {
              transactionCount,
            },
          },
          { status: 400 },
        );
      }

      logger.debug(
        'Platform dependencies check passed - no active transactions',
        {
          requestId,
          platformId: cleanedPlatformId,
          transactionCount,
          component: 'platforms',
          action: 'dependencies_check_success',
          operation: 'delete_platform',
        },
      );
    } catch (dependenciesError) {
      const errorCategory = categorizeError(dependenciesError);

      logger.error('Platform Dependencies Check Error', {
        category: errorCategory,
        message: dependenciesError.message,
        requestId,
        platformId: cleanedPlatformId,
        component: 'platforms',
        action: 'dependencies_check_failed',
        operation: 'delete_platform',
      });

      // Capturer l'erreur de vérification des dépendances avec Sentry
      captureDatabaseError(dependenciesError, {
        tags: {
          component: 'platforms',
          action: 'dependencies_check_failed',
          operation: 'SELECT',
          entity: 'platform',
        },
        extra: {
          requestId,
          platformId: cleanedPlatformId,
          table: 'admin.orders',
          queryType: 'dependencies_check',
          postgresCode: dependenciesError.code,
          ip: anonymizeIp(extractRealIp(request)),
        },
      });

      if (client) await client.cleanup();
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to verify platform dependencies',
          message: 'Something went wrong! Please try again',
        },
        { status: 500 },
      );
    }

    // ===== ÉTAPE 7: SUPPRESSION DE LA PLATEFORME EN BASE DE DONNÉES =====
    let deleteResult;
    try {
      logger.debug('Executing platform deletion query', {
        requestId,
        platformId: cleanedPlatformId,
        component: 'platforms',
        action: 'query_start',
        operation: 'delete_platform',
        table: 'admin.platforms',
      });

      // Supprimer uniquement si is_active = false (sécurité supplémentaire)
      deleteResult = await client.query(
        `DELETE FROM admin.platforms 
        WHERE platform_id = $1
        AND is_active = false
        RETURNING platform_name, platform_number, created_at`,
        [cleanedPlatformId],
      );

      if (deleteResult.rowCount === 0) {
        // Cela ne devrait pas arriver après nos vérifications, mais sécurité supplémentaire
        logger.error('Platform deletion failed - no rows affected', {
          requestId,
          platformId: cleanedPlatformId,
          component: 'platforms',
          action: 'deletion_no_rows_affected',
          operation: 'delete_platform',
        });

        // Capturer l'échec inattendu avec Sentry
        captureMessage('Platform deletion failed - no rows affected', {
          level: 'error',
          tags: {
            component: 'platforms',
            action: 'deletion_no_rows_affected',
            error_category: 'database_inconsistency',
            entity: 'platform',
            operation: 'delete',
          },
          extra: {
            requestId,
            platformId: cleanedPlatformId,
            ip: anonymizeIp(extractRealIp(request)),
          },
        });

        if (client) await client.cleanup();
        return NextResponse.json(
          {
            success: false,
            message:
              'Platform could not be deleted. It may be active or already deleted.',
            error: 'Deletion condition not met',
          },
          { status: 400 },
        );
      }

      logger.debug('Platform deletion query executed successfully', {
        requestId,
        platformId: cleanedPlatformId,
        platformName: deleteResult.rows[0].platform_name,
        component: 'platforms',
        action: 'query_success',
        operation: 'delete_platform',
        containsSensitiveData: true,
      });
    } catch (deleteError) {
      const errorCategory = categorizeError(deleteError);

      logger.error('Platform Deletion Error', {
        category: errorCategory,
        message: deleteError.message,
        operation: 'DELETE FROM admin.platforms',
        table: 'admin.platforms',
        requestId,
        platformId: cleanedPlatformId,
        component: 'platforms',
        action: 'query_failed',
      });

      // Capturer l'erreur de suppression avec Sentry
      captureDatabaseError(deleteError, {
        tags: {
          component: 'platforms',
          action: 'deletion_failed',
          operation: 'DELETE',
          entity: 'platform',
        },
        extra: {
          requestId,
          platformId: cleanedPlatformId,
          table: 'admin.platforms',
          queryType: 'platform_deletion',
          postgresCode: deleteError.code,
          postgresDetail: deleteError.detail ? '[Filtered]' : undefined,
          ip: anonymizeIp(extractRealIp(request)),
          rateLimitingApplied: true,
        },
      });

      if (client) await client.cleanup();
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to delete platform from database',
          message: 'Something went wrong! Please try again',
        },
        { status: 500 },
      );
    }

    // ===== ÉTAPE 8: INVALIDATION DU CACHE APRÈS SUCCÈS =====
    const deletedPlatform = deleteResult.rows[0];

    // Invalider le cache des plateformes après suppression réussie
    invalidatePlatformsCache(requestId, cleanedPlatformId);

    // ===== ÉTAPE 9: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Platform deletion successful', {
      platformId: cleanedPlatformId,
      platformName: deletedPlatform.platform_name,
      response_time_ms: responseTime,
      database_operations: 4, // connection + check + dependencies check + delete
      cache_invalidated: true,
      success: true,
      requestId,
      component: 'platforms',
      action: 'deletion_success',
      entity: 'platform',
      rateLimitingApplied: true,
      operation: 'delete_platform',
      containsSensitiveData: true,
    });

    // Capturer le succès de la suppression avec Sentry
    captureMessage('Platform deletion completed successfully', {
      level: 'info',
      tags: {
        component: 'platforms',
        action: 'deletion_success',
        success: 'true',
        entity: 'platform',
        operation: 'delete',
      },
      extra: {
        requestId,
        platformId: cleanedPlatformId,
        platformName: deletedPlatform.platform_name,
        responseTimeMs: responseTime,
        databaseOperations: 4,
        cacheInvalidated: true,
        ip: anonymizeIp(extractRealIp(request)),
        rateLimitingApplied: true,
        containsSensitiveData: true,
      },
    });

    if (client) await client.cleanup();

    return NextResponse.json(
      {
        success: true,
        message: 'Platform deleted successfully',
        platform: {
          id: cleanedPlatformId,
          name: deletedPlatform.platform_name,
          // Masquer le numéro dans la réponse pour sécurité
          number_masked: deletedPlatform.platform_number
            ? `${deletedPlatform.platform_number.slice(0, 3)}***${deletedPlatform.platform_number.slice(-2)}`
            : '[No Number]',
        },
        meta: {
          requestId,
          timestamp: new Date().toISOString(),
          security_note: 'Platform number is masked for security',
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

    logger.error('Global Delete Platform Error', {
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
      operation: 'delete_platform',
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
        operation: 'delete',
      },
      extra: {
        requestId,
        platformId: id,
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'platform_deletion',
        ip: anonymizeIp(extractRealIp(request)),
        rateLimitingApplied: true,
      },
    });

    if (client) await client.cleanup();

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: 'Something went wrong! Please try again',
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
