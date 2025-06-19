// app/api/dashboard/applications/[id]/delete/route.js
import { NextResponse } from 'next/server';
import cloudinary from '@backend/cloudinary';
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
import {
  applicationIdSchema,
  cleanUUID,
} from '@/utils/schemas/applicationSchema';
// AJOUT POUR L'INVALIDATION DU CACHE
import { dashboardCache, getDashboardCacheKey } from '@/utils/cache';

export const dynamic = 'force-dynamic';

// ----- CONFIGURATION DU RATE LIMITING POUR LA SUPPRESSION D'APPLICATIONS -----

// Créer le middleware de rate limiting spécifique pour la suppression d'applications
const deleteApplicationRateLimit = applyRateLimit('CONTENT_API', {
  // Configuration personnalisée pour la suppression d'applications
  windowMs: 10 * 60 * 1000, // 10 minutes (plus strict que templates car plus sensible)
  max: 5, // 5 suppressions par 10 minutes (très restrictif)
  message:
    "Trop de tentatives de suppression d'applications. Veuillez réessayer dans quelques minutes.",
  skipSuccessfulRequests: false, // Compter toutes les suppressions réussies
  skipFailedRequests: false, // Compter aussi les échecs
  prefix: 'delete_application', // Préfixe spécifique pour la suppression d'applications

  // Fonction personnalisée pour générer la clé (basée sur IP + ID de l'application)
  keyGenerator: (req) => {
    const ip = extractRealIp(req);
    const url = req.url || req.nextUrl?.pathname || '';
    const applicationIdMatch = url.match(/applications\/([^/]+)\/delete/);
    const applicationId = applicationIdMatch
      ? applicationIdMatch[1]
      : 'unknown';
    return `delete_application:ip:${ip}:application:${applicationId}`;
  },
});

// ----- FONCTION D'INVALIDATION DU CACHE -----
const invalidateApplicationsCache = (requestId, applicationId) => {
  try {
    const cacheKey = getDashboardCacheKey('applications_list', {
      endpoint: 'dashboard_applications',
      version: '1.0',
    });

    const cacheInvalidated = dashboardCache.applications.delete(cacheKey);

    logger.debug('Applications cache invalidation', {
      requestId,
      applicationId,
      component: 'applications',
      action: 'cache_invalidation',
      operation: 'delete_application',
      cacheKey,
      invalidated: cacheInvalidated,
    });

    // Capturer l'invalidation du cache avec Sentry
    captureMessage('Applications cache invalidated after deletion', {
      level: 'info',
      tags: {
        component: 'applications',
        action: 'cache_invalidation',
        entity: 'application',
        operation: 'delete',
      },
      extra: {
        requestId,
        applicationId,
        cacheKey,
        invalidated: cacheInvalidated,
      },
    });

    return cacheInvalidated;
  } catch (cacheError) {
    logger.warn('Failed to invalidate applications cache', {
      requestId,
      applicationId,
      component: 'applications',
      action: 'cache_invalidation_failed',
      operation: 'delete_application',
      error: cacheError.message,
    });

    captureException(cacheError, {
      level: 'warning',
      tags: {
        component: 'applications',
        action: 'cache_invalidation_failed',
        error_category: 'cache',
        entity: 'application',
        operation: 'delete',
      },
      extra: {
        requestId,
        applicationId,
      },
    });

    return false;
  }
};

// ----- API ROUTE PRINCIPALE AVEC RATE LIMITING ET MONITORING SENTRY -----

export async function DELETE(request, { params }) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();
  const { id } = params;

  logger.info('Delete Application API called', {
    timestamp: new Date().toISOString(),
    requestId,
    applicationId: id,
    component: 'applications',
    action: 'api_start',
    method: 'DELETE',
    operation: 'delete_application',
  });

  // Capturer le début du processus de suppression d'application
  captureMessage('Delete application process started', {
    level: 'info',
    tags: {
      component: 'applications',
      action: 'process_start',
      api_endpoint: '/api/dashboard/applications/[id]/delete',
      entity: 'application',
      operation: 'delete',
    },
    extra: {
      requestId,
      applicationId: id,
      timestamp: new Date().toISOString(),
      method: 'DELETE',
    },
  });

  try {
    // ===== ÉTAPE 1: VALIDATION DE L'ID DE L'APPLICATION =====
    logger.debug('Validating application ID', {
      requestId,
      applicationId: id,
      component: 'applications',
      action: 'id_validation_start',
      operation: 'delete_application',
    });

    try {
      await applicationIdSchema.validate({ id }, { abortEarly: false });

      logger.debug('Application ID validation passed', {
        requestId,
        applicationId: id,
        component: 'applications',
        action: 'id_validation_success',
        operation: 'delete_application',
      });
    } catch (idValidationError) {
      const errorCategory = categorizeError(idValidationError);

      logger.error('Application ID Validation Error', {
        category: errorCategory,
        applicationId: id,
        validation_errors: idValidationError.inner?.map(
          (err) => err.message,
        ) || [idValidationError.message],
        requestId,
        component: 'applications',
        action: 'id_validation_failed',
        operation: 'delete_application',
      });

      // Capturer l'erreur de validation d'ID avec Sentry
      captureMessage('Application ID validation failed', {
        level: 'warning',
        tags: {
          component: 'applications',
          action: 'id_validation_failed',
          error_category: 'validation',
          entity: 'application',
          operation: 'delete',
        },
        extra: {
          requestId,
          applicationId: id,
          validationErrors: idValidationError.inner?.map(
            (err) => err.message,
          ) || [idValidationError.message],
          ip: anonymizeIp(extractRealIp(request)),
        },
      });

      return NextResponse.json(
        {
          success: false,
          error: 'Invalid application ID format',
          message: 'This application does not exist',
          details: idValidationError.inner?.map((err) => err.message) || [
            idValidationError.message,
          ],
        },
        { status: 400 },
      );
    }

    // Nettoyer l'UUID pour garantir le format correct
    const cleanedApplicationId = cleanUUID(id);
    if (!cleanedApplicationId) {
      logger.warn('Application ID cleaning failed', {
        requestId,
        component: 'applications',
        action: 'id_cleaning_failed',
        operation: 'delete_application',
        providedId: id,
      });

      return NextResponse.json(
        {
          success: false,
          error: 'Invalid application ID format',
          message: 'This application does not exist',
        },
        { status: 400 },
      );
    }

    // ===== ÉTAPE 2: APPLIQUER LE RATE LIMITING =====
    logger.debug('Applying rate limiting for delete application API', {
      requestId,
      applicationId: cleanedApplicationId,
      component: 'applications',
      action: 'rate_limit_start',
      operation: 'delete_application',
    });

    const rateLimitResponse = await deleteApplicationRateLimit(request);

    if (rateLimitResponse) {
      logger.warn('Delete application API rate limit exceeded', {
        requestId,
        applicationId: cleanedApplicationId,
        component: 'applications',
        action: 'rate_limit_exceeded',
        operation: 'delete_application',
        ip: anonymizeIp(extractRealIp(request)),
      });

      // Capturer l'événement de rate limiting avec Sentry
      captureMessage('Delete application API rate limit exceeded', {
        level: 'warning',
        tags: {
          component: 'applications',
          action: 'rate_limit_exceeded',
          error_category: 'rate_limiting',
          entity: 'application',
          operation: 'delete',
        },
        extra: {
          requestId,
          applicationId: cleanedApplicationId,
          ip: anonymizeIp(extractRealIp(request)),
          userAgent:
            request.headers.get('user-agent')?.substring(0, 100) || 'unknown',
        },
      });

      return rateLimitResponse;
    }

    logger.debug('Rate limiting passed successfully', {
      requestId,
      applicationId: cleanedApplicationId,
      component: 'applications',
      action: 'rate_limit_passed',
      operation: 'delete_application',
    });

    // ===== ÉTAPE 3: VÉRIFICATION AUTHENTIFICATION =====
    logger.debug('Verifying user authentication', {
      requestId,
      applicationId: cleanedApplicationId,
      component: 'applications',
      action: 'auth_verification_start',
      operation: 'delete_application',
    });

    await isAuthenticatedUser(request, NextResponse);

    logger.debug('User authentication verified successfully', {
      requestId,
      applicationId: cleanedApplicationId,
      component: 'applications',
      action: 'auth_verification_success',
      operation: 'delete_application',
    });

    // ===== ÉTAPE 4: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
      logger.debug('Database connection successful', {
        requestId,
        applicationId: cleanedApplicationId,
        component: 'applications',
        action: 'db_connection_success',
        operation: 'delete_application',
      });
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Database Connection Error during application deletion', {
        category: errorCategory,
        message: dbConnectionError.message,
        timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
        requestId,
        applicationId: cleanedApplicationId,
        component: 'applications',
        action: 'db_connection_failed',
        operation: 'delete_application',
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
          applicationId: cleanedApplicationId,
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

    // ===== ÉTAPE 5: VÉRIFICATION DE L'EXISTENCE ET DE L'ÉTAT DE L'APPLICATION =====
    let applicationToDelete;
    try {
      logger.debug('Checking application existence and status', {
        requestId,
        applicationId: cleanedApplicationId,
        component: 'applications',
        action: 'application_check_start',
        operation: 'delete_application',
      });

      const checkResult = await client.query(
        `SELECT 
          application_id, 
          application_name, 
          application_images, 
          is_active,
          sales_count
        FROM catalog.applications 
        WHERE application_id = $1`,
        [cleanedApplicationId],
      );

      if (checkResult.rows.length === 0) {
        logger.warn('Application not found for deletion', {
          requestId,
          applicationId: cleanedApplicationId,
          component: 'applications',
          action: 'application_not_found',
          operation: 'delete_application',
        });

        // Capturer l'application non trouvée avec Sentry
        captureMessage('Application not found for deletion', {
          level: 'warning',
          tags: {
            component: 'applications',
            action: 'application_not_found',
            error_category: 'not_found',
            entity: 'application',
            operation: 'delete',
          },
          extra: {
            requestId,
            applicationId: cleanedApplicationId,
            ip: anonymizeIp(extractRealIp(request)),
          },
        });

        if (client) await client.cleanup();
        return NextResponse.json(
          {
            success: false,
            message: 'This application does not exist',
          },
          { status: 404 },
        );
      }

      applicationToDelete = checkResult.rows[0];

      // Vérifier que l'application est inactive (condition obligatoire pour la suppression)
      if (applicationToDelete.is_active === true) {
        logger.warn('Attempted to delete active application', {
          requestId,
          applicationId: cleanedApplicationId,
          applicationName: applicationToDelete.application_name,
          isActive: applicationToDelete.is_active,
          component: 'applications',
          action: 'active_application_deletion_blocked',
          operation: 'delete_application',
        });

        // Capturer la tentative de suppression d'une application active avec Sentry
        captureMessage('Attempted to delete active application', {
          level: 'warning',
          tags: {
            component: 'applications',
            action: 'active_application_deletion_blocked',
            error_category: 'business_rule_violation',
            entity: 'application',
            operation: 'delete',
          },
          extra: {
            requestId,
            applicationId: cleanedApplicationId,
            applicationName: applicationToDelete.application_name,
            isActive: applicationToDelete.is_active,
            ip: anonymizeIp(extractRealIp(request)),
          },
        });

        if (client) await client.cleanup();
        return NextResponse.json(
          {
            success: false,
            message:
              'Cannot delete active application. Please deactivate the application first.',
            error: 'Application is currently active',
          },
          { status: 400 },
        );
      }

      // Vérifier s'il y a des ventes (condition supplémentaire pour la sécurité)
      const salesCount = parseInt(applicationToDelete.sales_count) || 0;
      if (salesCount > 0) {
        logger.warn('Attempted to delete application with sales', {
          requestId,
          applicationId: cleanedApplicationId,
          applicationName: applicationToDelete.application_name,
          salesCount,
          component: 'applications',
          action: 'application_with_sales_deletion_blocked',
          operation: 'delete_application',
        });

        // Capturer la tentative de suppression d'une application avec ventes
        captureMessage('Attempted to delete application with sales', {
          level: 'warning',
          tags: {
            component: 'applications',
            action: 'application_with_sales_deletion_blocked',
            error_category: 'business_rule_violation',
            entity: 'application',
            operation: 'delete',
          },
          extra: {
            requestId,
            applicationId: cleanedApplicationId,
            applicationName: applicationToDelete.application_name,
            salesCount,
            ip: anonymizeIp(extractRealIp(request)),
          },
        });

        if (client) await client.cleanup();
        return NextResponse.json(
          {
            success: false,
            message:
              'Cannot delete application with existing sales. Please contact support for assistance.',
            error: 'Application has sales history',
          },
          { status: 400 },
        );
      }

      logger.debug(
        'Application validation passed - inactive application with no sales found',
        {
          requestId,
          applicationId: cleanedApplicationId,
          applicationName: applicationToDelete.application_name,
          isActive: applicationToDelete.is_active,
          salesCount,
          component: 'applications',
          action: 'application_check_success',
          operation: 'delete_application',
        },
      );
    } catch (checkError) {
      const errorCategory = categorizeError(checkError);

      logger.error('Application Check Error', {
        category: errorCategory,
        message: checkError.message,
        requestId,
        applicationId: cleanedApplicationId,
        component: 'applications',
        action: 'application_check_failed',
        operation: 'delete_application',
      });

      // Capturer l'erreur de vérification avec Sentry
      captureDatabaseError(checkError, {
        tags: {
          component: 'applications',
          action: 'application_check_failed',
          operation: 'SELECT',
          entity: 'application',
        },
        extra: {
          requestId,
          applicationId: cleanedApplicationId,
          table: 'catalog.applications',
          queryType: 'application_existence_check',
          postgresCode: checkError.code,
          ip: anonymizeIp(extractRealIp(request)),
        },
      });

      if (client) await client.cleanup();
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to verify application status',
          message: 'Something went wrong! Please try again',
        },
        { status: 500 },
      );
    }

    // ===== ÉTAPE 6: SUPPRESSION DE L'APPLICATION EN BASE DE DONNÉES =====
    let deleteResult;
    try {
      logger.debug('Executing application deletion query', {
        requestId,
        applicationId: cleanedApplicationId,
        component: 'applications',
        action: 'query_start',
        operation: 'delete_application',
        table: 'catalog.applications',
      });

      // Supprimer uniquement si is_active = false ET sales_count = 0 (sécurité supplémentaire)
      deleteResult = await client.query(
        `DELETE FROM catalog.applications 
         WHERE application_id = $1 
         AND is_active = false 
         AND (sales_count = 0 OR sales_count IS NULL)
         RETURNING application_name, application_images`,
        [cleanedApplicationId],
      );

      if (deleteResult.rowCount === 0) {
        // Cela ne devrait pas arriver après nos vérifications, mais sécurité supplémentaire
        logger.error('Application deletion failed - no rows affected', {
          requestId,
          applicationId: cleanedApplicationId,
          component: 'applications',
          action: 'deletion_no_rows_affected',
          operation: 'delete_application',
        });

        // Capturer l'échec inattendu avec Sentry
        captureMessage('Application deletion failed - no rows affected', {
          level: 'error',
          tags: {
            component: 'applications',
            action: 'deletion_no_rows_affected',
            error_category: 'database_inconsistency',
            entity: 'application',
            operation: 'delete',
          },
          extra: {
            requestId,
            applicationId: cleanedApplicationId,
            ip: anonymizeIp(extractRealIp(request)),
          },
        });

        if (client) await client.cleanup();
        return NextResponse.json(
          {
            success: false,
            message:
              'Application could not be deleted. It may be active, have sales, or already deleted.',
            error: 'Deletion conditions not met',
          },
          { status: 400 },
        );
      }

      logger.debug('Application deletion query executed successfully', {
        requestId,
        applicationId: cleanedApplicationId,
        applicationName: deleteResult.rows[0].application_name,
        component: 'applications',
        action: 'query_success',
        operation: 'delete_application',
      });
    } catch (deleteError) {
      const errorCategory = categorizeError(deleteError);

      logger.error('Application Deletion Error', {
        category: errorCategory,
        message: deleteError.message,
        operation: 'DELETE FROM catalog.applications',
        table: 'catalog.applications',
        requestId,
        applicationId: cleanedApplicationId,
        component: 'applications',
        action: 'query_failed',
      });

      // Capturer l'erreur de suppression avec Sentry
      captureDatabaseError(deleteError, {
        tags: {
          component: 'applications',
          action: 'deletion_failed',
          operation: 'DELETE',
          entity: 'application',
        },
        extra: {
          requestId,
          applicationId: cleanedApplicationId,
          table: 'catalog.applications',
          queryType: 'application_deletion',
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
          error: 'Failed to delete application from database',
          message: 'Something went wrong! Please try again',
        },
        { status: 500 },
      );
    }

    // ===== ÉTAPE 7: SUPPRESSION DES IMAGES CLOUDINARY =====
    const deletedApplication = deleteResult.rows[0];
    const cloudinaryImageIds =
      applicationToDelete.application_images ||
      deletedApplication.application_images ||
      [];

    let deletedImagesCount = 0;
    let failedImagesCount = 0;

    if (Array.isArray(cloudinaryImageIds) && cloudinaryImageIds.length > 0) {
      logger.debug('Deleting images from Cloudinary', {
        requestId,
        applicationId: cleanedApplicationId,
        imageCount: cloudinaryImageIds.length,
        component: 'applications',
        action: 'cloudinary_delete_start',
        operation: 'delete_application',
      });

      // Supprimer toutes les images en parallèle
      const deletePromises = cloudinaryImageIds.map(async (imageId) => {
        try {
          await cloudinary.uploader.destroy(imageId);
          deletedImagesCount++;

          logger.debug('Image deleted from Cloudinary', {
            requestId,
            applicationId: cleanedApplicationId,
            imageId,
            component: 'applications',
            action: 'cloudinary_delete_success',
            operation: 'delete_application',
          });
        } catch (cloudError) {
          failedImagesCount++;

          logger.error('Error deleting image from Cloudinary', {
            requestId,
            applicationId: cleanedApplicationId,
            imageId,
            error: cloudError.message,
            component: 'applications',
            action: 'cloudinary_delete_failed',
            operation: 'delete_application',
          });

          // Capturer l'erreur Cloudinary avec Sentry (non critique car l'application est déjà supprimée)
          captureException(cloudError, {
            level: 'warning',
            tags: {
              component: 'applications',
              action: 'cloudinary_delete_failed',
              error_category: 'media_upload',
              entity: 'application',
              operation: 'delete',
            },
            extra: {
              requestId,
              applicationId: cleanedApplicationId,
              imageId,
              applicationAlreadyDeleted: true,
            },
          });
        }
      });

      // Attendre toutes les suppressions
      await Promise.allSettled(deletePromises);

      logger.debug('Cloudinary images deletion completed', {
        requestId,
        applicationId: cleanedApplicationId,
        totalImages: cloudinaryImageIds.length,
        deletedImages: deletedImagesCount,
        failedImages: failedImagesCount,
        component: 'applications',
        action: 'cloudinary_delete_completed',
        operation: 'delete_application',
      });
    }

    // ===== ÉTAPE 8: INVALIDATION DU CACHE APRÈS SUCCÈS =====
    // Invalider le cache des applications après suppression réussie
    invalidateApplicationsCache(requestId, cleanedApplicationId);

    // ===== ÉTAPE 9: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Application deletion successful', {
      applicationId: cleanedApplicationId,
      applicationName: deletedApplication.application_name,
      totalImages: cloudinaryImageIds.length,
      deletedImages: deletedImagesCount,
      failedImages: failedImagesCount,
      response_time_ms: responseTime,
      database_operations: 3, // connection + check + delete
      cloudinary_operations: cloudinaryImageIds.length,
      cache_invalidated: true,
      success: true,
      requestId,
      component: 'applications',
      action: 'deletion_success',
      entity: 'application',
      rateLimitingApplied: true,
      operation: 'delete_application',
    });

    // Capturer le succès de la suppression avec Sentry
    captureMessage('Application deletion completed successfully', {
      level: 'info',
      tags: {
        component: 'applications',
        action: 'deletion_success',
        success: 'true',
        entity: 'application',
        operation: 'delete',
      },
      extra: {
        requestId,
        applicationId: cleanedApplicationId,
        applicationName: deletedApplication.application_name,
        totalImages: cloudinaryImageIds.length,
        deletedImages: deletedImagesCount,
        failedImages: failedImagesCount,
        responseTimeMs: responseTime,
        databaseOperations: 3,
        cloudinaryOperations: cloudinaryImageIds.length,
        cacheInvalidated: true,
        ip: anonymizeIp(extractRealIp(request)),
        rateLimitingApplied: true,
      },
    });

    if (client) await client.cleanup();

    return NextResponse.json(
      {
        success: true,
        message: 'Application and associated images deleted successfully',
        application: {
          id: cleanedApplicationId,
          name: deletedApplication.application_name,
        },
        images: {
          total: cloudinaryImageIds.length,
          deleted: deletedImagesCount,
          failed: failedImagesCount,
        },
        meta: {
          requestId,
          timestamp: new Date().toISOString(),
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

    logger.error('Global Delete Application Error', {
      category: errorCategory,
      response_time_ms: responseTime,
      reached_global_handler: true,
      error_name: error.name,
      error_message: error.message,
      stack_available: !!error.stack,
      requestId,
      applicationId: id,
      component: 'applications',
      action: 'global_error_handler',
      entity: 'application',
      operation: 'delete_application',
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
        operation: 'delete',
      },
      extra: {
        requestId,
        applicationId: id,
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'application_deletion',
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
