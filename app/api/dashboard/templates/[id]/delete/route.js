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
import { dashboardCache, getDashboardCacheKey } from '@/utils/cache';

export const dynamic = 'force-dynamic';

// Créer le middleware de rate limiting spécifique pour la suppression de templates
const deleteTemplateRateLimit = applyRateLimit('CONTENT_API', {
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // 10 suppressions par 5 minutes
  message:
    'Trop de tentatives de suppression de templates. Veuillez réessayer dans quelques minutes.',
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
  prefix: 'delete_template',

  keyGenerator: (req) => {
    const ip = extractRealIp(req);
    const url = req.url || req.nextUrl?.pathname || '';
    const templateIdMatch = url.match(/templates\/([^/]+)\/delete/);
    const templateId = templateIdMatch ? templateIdMatch[1] : 'unknown';
    return `delete_template:ip:${ip}:template:${templateId}`;
  },
});

// Fonction d'invalidation du cache
const invalidateTemplatesCache = (requestId, templateId) => {
  try {
    const cacheKey = getDashboardCacheKey('templates_list', {
      endpoint: 'dashboard_templates',
      version: '1.0',
    });

    const cacheInvalidated = dashboardCache.templates.delete(cacheKey);

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

// Fonction pour créer les headers de réponse
const createResponseHeaders = (
  requestId,
  responseTime,
  templateId,
  rateLimitInfo = null,
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
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Resource-Policy': 'same-site',
    'Content-Security-Policy': "default-src 'none'; connect-src 'self'",
    'X-Request-ID': requestId,
    'X-Response-Time': `${responseTime}ms`,
    'X-API-Version': '1.0',
    'X-Transaction-Type': 'mutation',
    'X-Operation-Type': 'delete',
    'X-Operation-Criticality': 'high',
    'X-Resource-ID': templateId,
    'X-Resource-Validation': 'template-id',
    'X-Business-Rule-Validation': 'inactive-only',
    'X-Cascade-Operations': 'database,cloudinary',
    'X-Cache-Invalidation': 'templates',
    'X-RateLimit-Window': '300',
    'X-RateLimit-Limit': '10',
    'X-Irreversible-Operation': 'true',
    'X-Data-Loss-Risk': 'high',
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

  logger.info('Delete Template API called', {
    requestId,
    templateId: id,
  });

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
    try {
      await templateIdSchema.validate({ id }, { abortEarly: false });
    } catch (idValidationError) {
      const errorCategory = categorizeError(idValidationError);

      logger.error('Template ID Validation Error', {
        category: errorCategory,
        templateId: id,
        validation_errors: idValidationError.inner?.map(
          (err) => err.message,
        ) || [idValidationError.message],
        requestId,
      });

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
    const rateLimitResponse = await deleteTemplateRateLimit(request);

    if (rateLimitResponse) {
      logger.warn('Delete template API rate limit exceeded', {
        requestId,
        templateId: id,
        ip: anonymizeIp(extractRealIp(request)),
      });

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

      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(requestId, responseTime, id, {
        remaining: 0,
      });

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

      logger.error('Database Connection Error during template deletion', {
        category: errorCategory,
        message: dbConnectionError.message,
        requestId,
        templateId: id,
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

    // ===== ÉTAPE 5: VÉRIFICATION DE L'EXISTENCE ET DE L'ÉTAT DU TEMPLATE =====
    let templateToDelete;
    try {
      const checkResult = await client.query(
        'SELECT template_id, template_name, template_image, is_active FROM catalog.templates WHERE template_id = $1',
        [id],
      );

      if (checkResult.rows.length === 0) {
        logger.warn('Template not found for deletion', {
          requestId,
          templateId: id,
        });

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

      // Vérifier que le template est inactif
      if (templateToDelete.is_active === true) {
        logger.warn('Attempted to delete active template', {
          requestId,
          templateId: id,
          templateName: templateToDelete.template_name,
          isActive: templateToDelete.is_active,
        });

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
    } catch (checkError) {
      const errorCategory = categorizeError(checkError);

      logger.error('Template Check Error', {
        category: errorCategory,
        message: checkError.message,
        requestId,
        templateId: id,
      });

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

    // ===== ÉTAPE 6: SUPPRESSION DU TEMPLATE EN BASE DE DONNÉES =====
    let deleteResult;
    try {
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
        logger.error('Template deletion failed - no rows affected', {
          requestId,
          templateId: id,
        });

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
    } catch (deleteError) {
      const errorCategory = categorizeError(deleteError);

      logger.error('Template Deletion Error', {
        category: errorCategory,
        message: deleteError.message,
        requestId,
        templateId: id,
      });

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

    // ===== ÉTAPE 7: SUPPRESSION DE L'IMAGE CLOUDINARY =====
    const deletedTemplate = deleteResult.rows[0];
    const cloudinaryImageId =
      templateToDelete.template_image || deletedTemplate.template_image;

    if (cloudinaryImageId) {
      try {
        await cloudinary.uploader.destroy(cloudinaryImageId);
      } catch (cloudError) {
        logger.error('Error deleting image from Cloudinary', {
          requestId,
          templateId: id,
          imageId: cloudinaryImageId,
          error: cloudError.message,
        });

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
      }
    }

    // ===== ÉTAPE 8: INVALIDATION DU CACHE APRÈS SUCCÈS =====
    invalidateTemplatesCache(requestId, id);

    // ===== ÉTAPE 9: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Template deletion successful', {
      templateId: id,
      templateName: deletedTemplate.template_name,
      response_time_ms: responseTime,
      success: true,
      requestId,
    });

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
      error_message: error.message,
      requestId,
      templateId: id,
    });

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
