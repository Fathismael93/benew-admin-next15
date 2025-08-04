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
import { dashboardCache, getDashboardCacheKey } from '@/utils/cache';

export const dynamic = 'force-dynamic';

// Créer le middleware de rate limiting spécifique pour la suppression d'applications
const deleteApplicationRateLimit = applyRateLimit('CONTENT_API', {
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5, // 5 suppressions par 10 minutes
  message:
    "Trop de tentatives de suppression d'applications. Veuillez réessayer dans quelques minutes.",
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
  prefix: 'delete_application',

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

// Fonction d'invalidation du cache
const invalidateApplicationsCache = (requestId, applicationId) => {
  try {
    const cacheKey = getDashboardCacheKey('applications_list', {
      endpoint: 'dashboard_applications',
      version: '1.0',
    });

    const cacheInvalidated = dashboardCache.applications.delete(cacheKey);

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

// Fonction pour créer les headers de réponse spécifiques à la suppression
const createResponseHeaders = (
  requestId,
  responseTime,
  applicationId,
  rateLimitInfo = null,
  cloudinaryOperations = 0,
  businessRulesValidated = false,
) => {
  const headers = {
    'Access-Control-Allow-Origin':
      process.env.NEXT_PUBLIC_SITE_URL || 'same-origin',
    'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
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
    'Permissions-Policy':
      'geolocation=(), microphone=(), camera=(), payment=(), usb=(), interest-cohort=()',
    'X-RateLimit-Window': '600',
    'X-RateLimit-Limit': '5',
    'X-Resource-Validation': 'application-id-required',
    'X-UUID-Validation': 'cleaned-and-verified',
    'X-Business-Rule-Validation': 'inactive-only',
    'X-Sales-Validation': 'zero-sales-required',
    'X-Media-Management': 'cloudinary-full-cleanup',
    'X-Cache-Invalidation': 'applications',
    'X-Database-Operations': '3',
    'X-Request-ID': requestId,
    'X-Response-Time': `${responseTime}ms`,
    'X-API-Version': '1.0',
    'X-Transaction-Type': 'mutation',
    'X-Entity-Type': 'application',
    'X-Operation-Type': 'delete',
    'X-Operation-Criticality': 'high',
    'X-Validation-Steps': 'business-rules',
    'X-Business-Rules-Validated': businessRulesValidated.toString(),
    'X-Cloudinary-Operations': cloudinaryOperations.toString(),
    Vary: 'Authorization, Content-Type',
    'X-Permitted-Cross-Domain-Policies': 'none',
    'X-Deleted-Resource-ID': applicationId,
    'X-Irreversible-Operation': 'true',
    'X-Data-Loss-Warning': 'permanent',
  };

  if (rateLimitInfo) {
    headers['X-RateLimit-Remaining'] =
      rateLimitInfo.remaining?.toString() || '0';
    headers['X-RateLimit-Reset'] = rateLimitInfo.resetTime?.toString() || '0';
  }

  return headers;
};

export async function DELETE(request, { params }) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();
  const { id } = params;
  let cloudinaryOperations = 0;
  let businessRulesValidated = false;

  logger.info('Delete Application API called', {
    requestId,
    applicationId: id,
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
    try {
      await applicationIdSchema.validate({ id }, { abortEarly: false });
    } catch (idValidationError) {
      const errorCategory = categorizeError(idValidationError);

      logger.error('Application ID Validation Error', {
        category: errorCategory,
        applicationId: id,
        validation_errors: idValidationError.inner?.map(
          (err) => err.message,
        ) || [idValidationError.message],
        requestId,
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

      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(requestId, responseTime, id);

      return NextResponse.json(
        {
          success: false,
          error: 'Invalid application ID format',
          message: 'This application does not exist',
          details: idValidationError.inner?.map((err) => err.message) || [
            idValidationError.message,
          ],
        },
        { status: 400, headers },
      );
    }

    // Nettoyer l'UUID pour garantir le format correct
    const cleanedApplicationId = cleanUUID(id);
    if (!cleanedApplicationId) {
      logger.warn('Application ID cleaning failed', {
        requestId,
        providedId: id,
      });

      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(requestId, responseTime, id);

      return NextResponse.json(
        {
          success: false,
          error: 'Invalid application ID format',
          message: 'This application does not exist',
        },
        { status: 400, headers },
      );
    }

    // ===== ÉTAPE 2: APPLIQUER LE RATE LIMITING =====
    const rateLimitResponse = await deleteApplicationRateLimit(request);

    if (rateLimitResponse) {
      logger.warn('Delete application API rate limit exceeded', {
        requestId,
        applicationId: cleanedApplicationId,
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

      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(
        requestId,
        responseTime,
        cleanedApplicationId,
        { remaining: 0 },
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

      logger.error('Database Connection Error during application deletion', {
        category: errorCategory,
        message: dbConnectionError.message,
        requestId,
        applicationId: cleanedApplicationId,
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

      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(
        requestId,
        responseTime,
        cleanedApplicationId,
      );

      return NextResponse.json(
        {
          success: false,
          error: 'Database connection failed',
        },
        { status: 503, headers },
      );
    }

    // ===== ÉTAPE 5: VÉRIFICATION DE L'EXISTENCE ET DE L'ÉTAT DE L'APPLICATION =====
    let applicationToDelete;
    try {
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

        const responseTime = Date.now() - startTime;
        const headers = createResponseHeaders(
          requestId,
          responseTime,
          cleanedApplicationId,
        );

        return NextResponse.json(
          {
            success: false,
            message: 'This application does not exist',
          },
          { status: 404, headers },
        );
      }

      applicationToDelete = checkResult.rows[0];

      // Vérifier que l'application est inactive
      if (applicationToDelete.is_active === true) {
        logger.warn('Attempted to delete active application', {
          requestId,
          applicationId: cleanedApplicationId,
          applicationName: applicationToDelete.application_name,
          isActive: applicationToDelete.is_active,
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

        const responseTime = Date.now() - startTime;
        const headers = createResponseHeaders(
          requestId,
          responseTime,
          cleanedApplicationId,
          null,
          0,
          false,
        );

        return NextResponse.json(
          {
            success: false,
            message:
              'Cannot delete active application. Please deactivate the application first.',
            error: 'Application is currently active',
          },
          { status: 400, headers },
        );
      }

      // Vérifier s'il y a des ventes
      const salesCount = parseInt(applicationToDelete.sales_count) || 0;
      if (salesCount > 0) {
        logger.warn('Attempted to delete application with sales', {
          requestId,
          applicationId: cleanedApplicationId,
          applicationName: applicationToDelete.application_name,
          salesCount,
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

        const responseTime = Date.now() - startTime;
        const headers = createResponseHeaders(
          requestId,
          responseTime,
          cleanedApplicationId,
          null,
          0,
          false,
        );

        return NextResponse.json(
          {
            success: false,
            message:
              'Cannot delete application with existing sales. Please contact support for assistance.',
            error: 'Application has sales history',
          },
          { status: 400, headers },
        );
      }

      // Les règles métier sont validées
      businessRulesValidated = true;
    } catch (checkError) {
      const errorCategory = categorizeError(checkError);

      logger.error('Application Check Error', {
        category: errorCategory,
        message: checkError.message,
        requestId,
        applicationId: cleanedApplicationId,
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

      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(
        requestId,
        responseTime,
        cleanedApplicationId,
      );

      return NextResponse.json(
        {
          success: false,
          error: 'Failed to verify application status',
          message: 'Something went wrong! Please try again',
        },
        { status: 500, headers },
      );
    }

    // ===== ÉTAPE 6: SUPPRESSION DE L'APPLICATION EN BASE DE DONNÉES =====
    let deleteResult;
    try {
      // Supprimer uniquement si is_active = false ET sales_count = 0
      deleteResult = await client.query(
        `DELETE FROM catalog.applications 
         WHERE application_id = $1 
         AND is_active = false 
         AND (sales_count = 0 OR sales_count IS NULL)
         RETURNING application_name, application_images`,
        [cleanedApplicationId],
      );

      if (deleteResult.rowCount === 0) {
        logger.error('Application deletion failed - no rows affected', {
          requestId,
          applicationId: cleanedApplicationId,
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

        const responseTime = Date.now() - startTime;
        const headers = createResponseHeaders(
          requestId,
          responseTime,
          cleanedApplicationId,
          null,
          0,
          businessRulesValidated,
        );

        return NextResponse.json(
          {
            success: false,
            message:
              'Application could not be deleted. It may be active, have sales, or already deleted.',
            error: 'Deletion conditions not met',
          },
          { status: 400, headers },
        );
      }
    } catch (deleteError) {
      const errorCategory = categorizeError(deleteError);

      logger.error('Application Deletion Error', {
        category: errorCategory,
        message: deleteError.message,
        requestId,
        applicationId: cleanedApplicationId,
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

      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(
        requestId,
        responseTime,
        cleanedApplicationId,
        null,
        0,
        businessRulesValidated,
      );

      return NextResponse.json(
        {
          success: false,
          error: 'Failed to delete application from database',
          message: 'Something went wrong! Please try again',
        },
        { status: 500, headers },
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
      // Supprimer toutes les images en parallèle
      const deletePromises = cloudinaryImageIds.map(async (imageId) => {
        try {
          await cloudinary.uploader.destroy(imageId);
          deletedImagesCount++;
          cloudinaryOperations++;
        } catch (cloudError) {
          failedImagesCount++;

          logger.error('Error deleting image from Cloudinary', {
            requestId,
            applicationId: cleanedApplicationId,
            imageId,
            error: cloudError.message,
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
    }

    // ===== ÉTAPE 8: INVALIDATION DU CACHE APRÈS SUCCÈS =====
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
      success: true,
      requestId,
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
        cloudinaryOperations: cloudinaryOperations,
        cacheInvalidated: true,
        businessRulesValidated: businessRulesValidated,
        ip: anonymizeIp(extractRealIp(request)),
        rateLimitingApplied: true,
      },
    });

    if (client) await client.cleanup();

    // Créer les headers de succès avec toutes les informations
    const headers = createResponseHeaders(
      requestId,
      responseTime,
      cleanedApplicationId,
      null,
      cloudinaryOperations,
      businessRulesValidated,
    );

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
          businessRulesValidated,
          cloudinaryOperations,
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

    logger.error('Global Delete Application Error', {
      category: errorCategory,
      response_time_ms: responseTime,
      error_message: error.message,
      requestId,
      applicationId: id,
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

    // Créer les headers même en cas d'erreur globale
    const headers = createResponseHeaders(
      requestId,
      responseTime,
      id,
      null,
      cloudinaryOperations,
      businessRulesValidated,
    );

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: 'Something went wrong! Please try again',
        requestId,
      },
      {
        status: 500,
        headers: headers,
      },
    );
  }
}
