// app/api/dashboard/templates/[id]/delete/route.js
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
import { templateIdSchema } from '@/utils/schemas/templateSchema';
// AJOUT POUR L'INVALIDATION DU CACHE
import { dashboardCache, getDashboardCacheKey } from '@/utils/cache';

export const dynamic = 'force-dynamic';

// ----- CONFIGURATION DU RATE LIMITING POUR LA SUPPRESSION DE TEMPLATES -----

// Créer le middleware de rate limiting spécifique pour la suppression de templates
const deleteTemplateRateLimit = applyRateLimit('CONTENT_API', {
  // Configuration personnalisée pour la suppression de templates
  windowMs: 5 * 60 * 1000, // 5 minutes (plus strict pour les suppressions)
  max: 10, // 10 suppressions par 5 minutes (très restrictif)
  message:
    'Trop de tentatives de suppression de templates. Veuillez réessayer dans quelques minutes.',
  skipSuccessfulRequests: false, // Compter toutes les suppressions réussies
  skipFailedRequests: false, // Compter aussi les échecs
  prefix: 'delete_template', // Préfixe spécifique pour la suppression de templates

  // Fonction personnalisée pour générer la clé (basée sur IP + ID du template)
  keyGenerator: (req) => {
    const ip = extractRealIp(req);
    const url = req.url || req.nextUrl?.pathname || '';
    const templateIdMatch = url.match(/templates\/([^/]+)\/delete/);
    const templateId = templateIdMatch ? templateIdMatch[1] : 'unknown';
    return `delete_template:ip:${ip}:template:${templateId}`;
  },
});

// ----- FONCTION D'INVALIDATION DU CACHE -----
const invalidateTemplatesCache = (requestId, templateId) => {
  try {
    const cacheKey = getDashboardCacheKey('templates_list', {
      endpoint: 'dashboard_templates',
      version: '1.0',
    });

    const cacheInvalidated = dashboardCache.templates.delete(cacheKey);

    logger.debug('Templates cache invalidation', {
      requestId,
      templateId,
      component: 'templates',
      action: 'cache_invalidation',
      operation: 'delete_template',
      cacheKey,
      invalidated: cacheInvalidated,
    });

    // Capturer l'invalidation du cache avec Sentry
    captureMessage('Templates cache invalidated after deletion', {
      level: 'info',
      tags: {
        component: 'templates',
        action: 'cache_invalidation',
        entity: 'template',
        operation: 'delete',
      },
      extra: {
        requestId,
        templateId,
        cacheKey,
        invalidated: cacheInvalidated,
      },
    });

    return cacheInvalidated;
  } catch (cacheError) {
    logger.warn('Failed to invalidate templates cache', {
      requestId,
      templateId,
      component: 'templates',
      action: 'cache_invalidation_failed',
      operation: 'delete_template',
      error: cacheError.message,
    });

    captureException(cacheError, {
      level: 'warning',
      tags: {
        component: 'templates',
        action: 'cache_invalidation_failed',
        error_category: 'cache',
        entity: 'template',
        operation: 'delete',
      },
      extra: {
        requestId,
        templateId,
      },
    });

    return false;
  }
};

// ----- FONCTION POUR CRÉER LES HEADERS DE RÉPONSE -----
const createResponseHeaders = (
  requestId,
  responseTime,
  templateId,
  rateLimitInfo = null,
) => {
  const headers = {
    // CORS spécifique pour mutations de suppression
    'Access-Control-Allow-Origin':
      process.env.NEXT_PUBLIC_SITE_URL || 'same-origin',
    'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
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

    // Headers spécifiques à la suppression
    'X-Transaction-Type': 'mutation',
    'X-Operation-Type': 'delete',
    'X-Operation-Criticality': 'high',
    'X-Resource-ID': templateId,
    'X-Resource-Validation': 'template-id',
    'X-Business-Rule-Validation': 'inactive-only',
    'X-Cascade-Operations': 'database,cloudinary',
    'X-Cache-Invalidation': 'templates',

    // Rate limiting strict pour suppressions
    'X-RateLimit-Window': '300', // 5 minutes en secondes
    'X-RateLimit-Limit': '10',

    // Headers de sécurité supplémentaires pour opération critique
    'X-Irreversible-Operation': 'true',
    'X-Data-Loss-Risk': 'high',
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

export async function DELETE(request, { params }) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();
  const { id } = params;

  logger.info('Delete Template API called', {
    timestamp: new Date().toISOString(),
    requestId,
    templateId: id,
    component: 'templates',
    action: 'api_start',
    method: 'DELETE',
    operation: 'delete_template',
  });

  // Capturer le début du processus de suppression de template
  captureMessage('Delete template process started', {
    level: 'info',
    tags: {
      component: 'templates',
      action: 'process_start',
      api_endpoint: '/api/dashboard/templates/[id]/delete',
      entity: 'template',
      operation: 'delete',
    },
    extra: {
      requestId,
      templateId: id,
      timestamp: new Date().toISOString(),
      method: 'DELETE',
    },
  });

  try {
    // ===== ÉTAPE 1: VALIDATION DE L'ID DU TEMPLATE =====
    logger.debug('Validating template ID', {
      requestId,
      templateId: id,
      component: 'templates',
      action: 'id_validation_start',
      operation: 'delete_template',
    });

    try {
      await templateIdSchema.validate({ id }, { abortEarly: false });

      logger.debug('Template ID validation passed', {
        requestId,
        templateId: id,
        component: 'templates',
        action: 'id_validation_success',
        operation: 'delete_template',
      });
    } catch (idValidationError) {
      const errorCategory = categorizeError(idValidationError);

      logger.error('Template ID Validation Error', {
        category: errorCategory,
        templateId: id,
        validation_errors: idValidationError.inner?.map(
          (err) => err.message,
        ) || [idValidationError.message],
        requestId,
        component: 'templates',
        action: 'id_validation_failed',
        operation: 'delete_template',
      });

      // Capturer l'erreur de validation d'ID avec Sentry
      captureMessage('Template ID validation failed', {
        level: 'warning',
        tags: {
          component: 'templates',
          action: 'id_validation_failed',
          error_category: 'validation',
          entity: 'template',
          operation: 'delete',
        },
        extra: {
          requestId,
          templateId: id,
          validationErrors: idValidationError.inner?.map(
            (err) => err.message,
          ) || [idValidationError.message],
        },
      });

      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(requestId, responseTime, id);

      return NextResponse.json(
        {
          success: false,
          error: 'Invalid template ID format',
          message: 'This template does not exist',
          details: idValidationError.inner?.map((err) => err.message) || [
            idValidationError.message,
          ],
        },
        { status: 400, headers },
      );
    }

    // ===== ÉTAPE 2: APPLIQUER LE RATE LIMITING =====
    logger.debug('Applying rate limiting for delete template API', {
      requestId,
      templateId: id,
      component: 'templates',
      action: 'rate_limit_start',
      operation: 'delete_template',
    });

    const rateLimitResponse = await deleteTemplateRateLimit(request);

    // Si le rate limiter retourne une réponse, cela signifie que la limite est dépassée
    if (rateLimitResponse) {
      logger.warn('Delete template API rate limit exceeded', {
        requestId,
        templateId: id,
        component: 'templates',
        action: 'rate_limit_exceeded',
        operation: 'delete_template',
        ip: anonymizeIp(extractRealIp(request)),
      });

      // Capturer l'événement de rate limiting avec Sentry
      captureMessage('Delete template API rate limit exceeded', {
        level: 'warning',
        tags: {
          component: 'templates',
          action: 'rate_limit_exceeded',
          error_category: 'rate_limiting',
          entity: 'template',
          operation: 'delete',
        },
        extra: {
          requestId,
          templateId: id,
          ip: anonymizeIp(extractRealIp(request)),
          userAgent:
            request.headers.get('user-agent')?.substring(0, 100) || 'unknown',
        },
      });

      // Ajouter les headers de sécurité même en cas de rate limit
      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(requestId, responseTime, id, {
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
      templateId: id,
      component: 'templates',
      action: 'rate_limit_passed',
      operation: 'delete_template',
    });

    // ===== ÉTAPE 3: VÉRIFICATION AUTHENTIFICATION =====
    logger.debug('Verifying user authentication', {
      requestId,
      templateId: id,
      component: 'templates',
      action: 'auth_verification_start',
      operation: 'delete_template',
    });

    await isAuthenticatedUser(request, NextResponse);

    logger.debug('User authentication verified successfully', {
      requestId,
      templateId: id,
      component: 'templates',
      action: 'auth_verification_success',
      operation: 'delete_template',
    });

    // ===== ÉTAPE 4: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
      logger.debug('Database connection successful', {
        requestId,
        templateId: id,
        component: 'templates',
        action: 'db_connection_success',
        operation: 'delete_template',
      });
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Database Connection Error during template deletion', {
        category: errorCategory,
        message: dbConnectionError.message,
        timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
        requestId,
        templateId: id,
        component: 'templates',
        action: 'db_connection_failed',
        operation: 'delete_template',
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
          templateId: id,
          timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
          ip: anonymizeIp(extractRealIp(request)),
          rateLimitingApplied: true,
        },
      });

      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(requestId, responseTime, id);

      return NextResponse.json(
        {
          success: false,
          error: 'Database connection failed',
        },
        { status: 503, headers },
      );
    }

    // ===== ÉTAPE 6: VÉRIFICATION DE L'EXISTENCE ET DE L'ÉTAT DU TEMPLATE =====
    let templateToDelete;
    try {
      logger.debug('Checking template existence and status', {
        requestId,
        templateId: id,
        component: 'templates',
        action: 'template_check_start',
        operation: 'delete_template',
      });

      const checkResult = await client.query(
        'SELECT template_id, template_name, template_image, is_active FROM catalog.templates WHERE template_id = $1',
        [id],
      );

      if (checkResult.rows.length === 0) {
        logger.warn('Template not found for deletion', {
          requestId,
          templateId: id,
          component: 'templates',
          action: 'template_not_found',
          operation: 'delete_template',
        });

        // Capturer le template non trouvé avec Sentry
        captureMessage('Template not found for deletion', {
          level: 'warning',
          tags: {
            component: 'templates',
            action: 'template_not_found',
            error_category: 'not_found',
            entity: 'template',
            operation: 'delete',
          },
          extra: {
            requestId,
            templateId: id,
            ip: anonymizeIp(extractRealIp(request)),
          },
        });

        if (client) await client.cleanup();

        const responseTime = Date.now() - startTime;
        const headers = createResponseHeaders(requestId, responseTime, id);

        return NextResponse.json(
          {
            success: false,
            message: 'This template does not exist',
          },
          { status: 404, headers },
        );
      }

      templateToDelete = checkResult.rows[0];

      // Vérifier que le template est inactif (condition obligatoire pour la suppression)
      if (templateToDelete.is_active === true) {
        logger.warn('Attempted to delete active template', {
          requestId,
          templateId: id,
          templateName: templateToDelete.template_name,
          isActive: templateToDelete.is_active,
          component: 'templates',
          action: 'active_template_deletion_blocked',
          operation: 'delete_template',
        });

        // Capturer la tentative de suppression d'un template actif avec Sentry
        captureMessage('Attempted to delete active template', {
          level: 'warning',
          tags: {
            component: 'templates',
            action: 'active_template_deletion_blocked',
            error_category: 'business_rule_violation',
            entity: 'template',
            operation: 'delete',
          },
          extra: {
            requestId,
            templateId: id,
            templateName: templateToDelete.template_name,
            isActive: templateToDelete.is_active,
            ip: anonymizeIp(extractRealIp(request)),
          },
        });

        if (client) await client.cleanup();

        const responseTime = Date.now() - startTime;
        const headers = createResponseHeaders(requestId, responseTime, id);

        return NextResponse.json(
          {
            success: false,
            message:
              'Cannot delete active template. Please deactivate the template first.',
            error: 'Template is currently active',
          },
          { status: 400, headers },
        );
      }

      logger.debug('Template validation passed - inactive template found', {
        requestId,
        templateId: id,
        templateName: templateToDelete.template_name,
        isActive: templateToDelete.is_active,
        component: 'templates',
        action: 'template_check_success',
        operation: 'delete_template',
      });
    } catch (checkError) {
      const errorCategory = categorizeError(checkError);

      logger.error('Template Check Error', {
        category: errorCategory,
        message: checkError.message,
        requestId,
        templateId: id,
        component: 'templates',
        action: 'template_check_failed',
        operation: 'delete_template',
      });

      // Capturer l'erreur de vérification avec Sentry
      captureDatabaseError(checkError, {
        tags: {
          component: 'templates',
          action: 'template_check_failed',
          operation: 'SELECT',
          entity: 'template',
        },
        extra: {
          requestId,
          templateId: id,
          table: 'catalog.templates',
          queryType: 'template_existence_check',
          postgresCode: checkError.code,
          ip: anonymizeIp(extractRealIp(request)),
        },
      });

      if (client) await client.cleanup();

      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(requestId, responseTime, id);

      return NextResponse.json(
        {
          success: false,
          error: 'Failed to verify template status',
          message: 'Something went wrong! Please try again',
        },
        { status: 500, headers },
      );
    }

    // ===== ÉTAPE 7: SUPPRESSION DU TEMPLATE EN BASE DE DONNÉES =====
    let deleteResult;
    try {
      logger.debug('Executing template deletion query', {
        requestId,
        templateId: id,
        component: 'templates',
        action: 'query_start',
        operation: 'delete_template',
        table: 'catalog.templates',
      });

      // Supprimer uniquement si is_active = false (sécurité supplémentaire)
      deleteResult = await client.query(
        `DELETE FROM catalog.templates 
        WHERE template_id = $1
        AND is_active = false
        AND (sales_count = 0 OR sales_count IS NULL)
        RETURNING template_name, template_image`,
        [id],
      );

      if (deleteResult.rowCount === 0) {
        // Cela ne devrait pas arriver après nos vérifications, mais sécurité supplémentaire
        logger.error('Template deletion failed - no rows affected', {
          requestId,
          templateId: id,
          component: 'templates',
          action: 'deletion_no_rows_affected',
          operation: 'delete_template',
        });

        // Capturer l'échec inattendu avec Sentry
        captureMessage('Template deletion failed - no rows affected', {
          level: 'error',
          tags: {
            component: 'templates',
            action: 'deletion_no_rows_affected',
            error_category: 'database_inconsistency',
            entity: 'template',
            operation: 'delete',
          },
          extra: {
            requestId,
            templateId: id,
            ip: anonymizeIp(extractRealIp(request)),
          },
        });

        if (client) await client.cleanup();

        const responseTime = Date.now() - startTime;
        const headers = createResponseHeaders(requestId, responseTime, id);

        return NextResponse.json(
          {
            success: false,
            message:
              'Template could not be deleted. It may be active or already deleted.',
            error: 'Deletion condition not met',
          },
          { status: 400, headers },
        );
      }

      logger.debug('Template deletion query executed successfully', {
        requestId,
        templateId: id,
        templateName: deleteResult.rows[0].template_name,
        component: 'templates',
        action: 'query_success',
        operation: 'delete_template',
      });
    } catch (deleteError) {
      const errorCategory = categorizeError(deleteError);

      logger.error('Template Deletion Error', {
        category: errorCategory,
        message: deleteError.message,
        operation: 'DELETE FROM catalog.templates',
        table: 'catalog.templates',
        requestId,
        templateId: id,
        component: 'templates',
        action: 'query_failed',
      });

      // Capturer l'erreur de suppression avec Sentry
      captureDatabaseError(deleteError, {
        tags: {
          component: 'templates',
          action: 'deletion_failed',
          operation: 'DELETE',
          entity: 'template',
        },
        extra: {
          requestId,
          templateId: id,
          table: 'catalog.templates',
          queryType: 'template_deletion',
          postgresCode: deleteError.code,
          postgresDetail: deleteError.detail ? '[Filtered]' : undefined,
          ip: anonymizeIp(extractRealIp(request)),
          rateLimitingApplied: true,
        },
      });

      if (client) await client.cleanup();

      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(requestId, responseTime, id);

      return NextResponse.json(
        {
          success: false,
          error: 'Failed to delete template from database',
          message: 'Something went wrong! Please try again',
        },
        { status: 500, headers },
      );
    }

    // ===== ÉTAPE 8: SUPPRESSION DE L'IMAGE CLOUDINARY =====
    const deletedTemplate = deleteResult.rows[0];
    const cloudinaryImageId =
      templateToDelete.template_image || deletedTemplate.template_image;

    if (cloudinaryImageId) {
      try {
        logger.debug('Deleting image from Cloudinary', {
          requestId,
          templateId: id,
          imageId: cloudinaryImageId,
          component: 'templates',
          action: 'cloudinary_delete_start',
          operation: 'delete_template',
        });

        await cloudinary.uploader.destroy(cloudinaryImageId);

        logger.debug('Image deleted from Cloudinary successfully', {
          requestId,
          templateId: id,
          imageId: cloudinaryImageId,
          component: 'templates',
          action: 'cloudinary_delete_success',
          operation: 'delete_template',
        });
      } catch (cloudError) {
        logger.error('Error deleting image from Cloudinary', {
          requestId,
          templateId: id,
          imageId: cloudinaryImageId,
          error: cloudError.message,
          component: 'templates',
          action: 'cloudinary_delete_failed',
          operation: 'delete_template',
        });

        // Capturer l'erreur Cloudinary avec Sentry (non critique car le template est déjà supprimé)
        captureException(cloudError, {
          level: 'warning',
          tags: {
            component: 'templates',
            action: 'cloudinary_delete_failed',
            error_category: 'media_upload',
            entity: 'template',
            operation: 'delete',
          },
          extra: {
            requestId,
            templateId: id,
            imageId: cloudinaryImageId,
            templateAlreadyDeleted: true,
          },
        });
        // Ne pas faire échouer la suppression si Cloudinary échoue
      }
    }

    // ===== ÉTAPE 9: INVALIDATION DU CACHE APRÈS SUCCÈS =====
    // Invalider le cache des templates après suppression réussie
    invalidateTemplatesCache(requestId, id);

    // ===== ÉTAPE 10: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Template deletion successful', {
      templateId: id,
      templateName: deletedTemplate.template_name,
      imageId: cloudinaryImageId,
      response_time_ms: responseTime,
      database_operations: 3, // connection + check + delete
      cloudinary_operations: cloudinaryImageId ? 1 : 0,
      cache_invalidated: true,
      success: true,
      requestId,
      component: 'templates',
      action: 'deletion_success',
      entity: 'template',
      rateLimitingApplied: true,
      operation: 'delete_template',
    });

    // Capturer le succès de la suppression avec Sentry
    captureMessage('Template deletion completed successfully', {
      level: 'info',
      tags: {
        component: 'templates',
        action: 'deletion_success',
        success: 'true',
        entity: 'template',
        operation: 'delete',
      },
      extra: {
        requestId,
        templateId: id,
        templateName: deletedTemplate.template_name,
        imageId: cloudinaryImageId,
        responseTimeMs: responseTime,
        databaseOperations: 3,
        cloudinaryOperations: cloudinaryImageId ? 1 : 0,
        cacheInvalidated: true,
        ip: anonymizeIp(extractRealIp(request)),
        rateLimitingApplied: true,
      },
    });

    if (client) await client.cleanup();

    // Créer les headers de succès
    const headers = createResponseHeaders(requestId, responseTime, id);

    return NextResponse.json(
      {
        success: true,
        message: 'Template and associated image deleted successfully',
        template: {
          id: id,
          name: deletedTemplate.template_name,
        },
        meta: {
          requestId,
          timestamp: new Date().toISOString(),
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

    logger.error('Global Delete Template Error', {
      category: errorCategory,
      response_time_ms: responseTime,
      reached_global_handler: true,
      error_name: error.name,
      error_message: error.message,
      stack_available: !!error.stack,
      requestId,
      templateId: id,
      component: 'templates',
      action: 'global_error_handler',
      entity: 'template',
      operation: 'delete_template',
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
        operation: 'delete',
      },
      extra: {
        requestId,
        templateId: id,
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'template_deletion',
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
