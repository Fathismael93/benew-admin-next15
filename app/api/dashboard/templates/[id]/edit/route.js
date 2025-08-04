/* eslint-disable no-unused-vars */
// app/api/dashboard/templates/[id]/edit/route.js
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
import { sanitizeTemplateInputsStrict } from '@/utils/sanitizers/sanitizeTemplateInputs';
import {
  templateUpdateSchema,
  templateIdSchema,
} from '@/utils/schemas/templateSchema';
import { dashboardCache, getDashboardCacheKey } from '@/utils/cache';

// Créer le middleware de rate limiting spécifique pour la modification de templates
const editTemplateRateLimit = applyRateLimit('CONTENT_API', {
  windowMs: 2 * 60 * 1000, // 2 minutes
  max: 20, // 20 modifications par 2 minutes
  message:
    'Trop de tentatives de modification de templates. Veuillez réessayer dans quelques minutes.',
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
  prefix: 'edit_template',

  keyGenerator: (req) => {
    const ip = extractRealIp(req);
    const url = req.url || req.nextUrl?.pathname || '';
    const templateIdMatch = url.match(/templates\/([^/]+)\/edit/);
    const templateId = templateIdMatch ? templateIdMatch[1] : 'unknown';
    return `edit_template:ip:${ip}:template:${templateId}`;
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

    captureMessage('Templates cache invalidated after modification', {
      level: 'info',
      tags: {
        component: 'templates',
        action: 'cache_invalidation',
        entity: 'template',
        operation: 'update',
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
        operation: 'update',
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
    'Access-Control-Allow-Methods': 'PUT, OPTIONS',
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
    'X-Operation-Type': 'update',
    'X-Resource-ID': templateId,
    'X-Cache-Invalidation': 'templates',
    'X-RateLimit-Window': '120',
    'X-RateLimit-Limit': '20',
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

  logger.info('Edit Template API called', {
    requestId,
    templateId: id,
  });

  captureMessage('Edit template process started', {
    level: 'info',
    tags: {
      component: 'templates',
      action: 'process_start',
      api_endpoint: '/api/dashboard/templates/[id]/edit',
      entity: 'template',
      operation: 'update',
    },
    extra: {
      requestId,
      templateId: id,
      timestamp: new Date().toISOString(),
      method: 'PUT',
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
          operation: 'update',
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
          error: 'Invalid template ID format',
          details: idValidationError.inner?.map((err) => err.message) || [
            idValidationError.message,
          ],
        },
        { status: 400, headers },
      );
    }

    // ===== ÉTAPE 2: APPLIQUER LE RATE LIMITING =====
    const rateLimitResponse = await editTemplateRateLimit(request);

    if (rateLimitResponse) {
      logger.warn('Edit template API rate limit exceeded', {
        requestId,
        templateId: id,
        ip: anonymizeIp(extractRealIp(request)),
      });

      captureMessage('Edit template API rate limit exceeded', {
        level: 'warning',
        tags: {
          component: 'templates',
          action: 'rate_limit_exceeded',
          error_category: 'rate_limiting',
          entity: 'template',
          operation: 'update',
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

      logger.error('Database Connection Error during template edit', {
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

      logger.error('JSON Parse Error during template edit', {
        category: errorCategory,
        message: parseError.message,
        requestId,
        templateId: id,
      });

      captureException(parseError, {
        level: 'error',
        tags: {
          component: 'templates',
          action: 'json_parse_error',
          error_category: categorizeError(parseError),
          operation: 'update',
        },
        extra: {
          requestId,
          templateId: id,
          contentType: request.headers.get('content-type'),
          userAgent: request.headers.get('user-agent')?.substring(0, 100),
        },
      });

      if (client) await client.cleanup();

      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(requestId, responseTime, id);

      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400, headers },
      );
    }

    const {
      templateName,
      templateImageId,
      templateColor,
      templateHasWeb,
      templateHasMobile,
      isActive,
      oldImageId,
    } = body;

    // ===== ÉTAPE 6: SANITIZATION DES INPUTS (SAUF isActive) =====
    const dataToSanitize = {
      templateName,
      templateImageId,
      templateColor,
      templateHasWeb,
      templateHasMobile,
    };

    const filteredDataToSanitize = Object.fromEntries(
      Object.entries(dataToSanitize).filter(
        ([_, value]) => value !== undefined,
      ),
    );

    const sanitizedInputs = sanitizeTemplateInputsStrict(
      filteredDataToSanitize,
    );

    const {
      templateName: sanitizedTemplateName,
      templateImageId: sanitizedTemplateImageId,
      templateColor: sanitizedTemplateColor,
      templateHasWeb: sanitizedTemplateHasWeb,
      templateHasMobile: sanitizedTemplateHasMobile,
    } = sanitizedInputs;

    const finalData = {
      templateName: sanitizedTemplateName,
      templateImageId: sanitizedTemplateImageId,
      templateColor: sanitizedTemplateColor,
      templateHasWeb: sanitizedTemplateHasWeb,
      templateHasMobile: sanitizedTemplateHasMobile,
      isActive, // Non sanitizé
      oldImageId, // Non sanitizé car utilisé pour la logique interne
    };

    // ===== ÉTAPE 7: VALIDATION AVEC YUP =====
    try {
      const dataToValidate = Object.fromEntries(
        Object.entries({
          templateName: sanitizedTemplateName,
          templateImageId: sanitizedTemplateImageId,
          templateColor: sanitizedTemplateColor,
          templateHasWeb: sanitizedTemplateHasWeb,
          templateHasMobile: sanitizedTemplateHasMobile,
          isActive,
        }).filter(([_, value]) => value !== undefined),
      );

      await templateUpdateSchema.validate(dataToValidate, {
        abortEarly: false,
      });
    } catch (validationError) {
      const errorCategory = categorizeError(validationError);

      logger.error('Template Validation Error with Yup', {
        category: errorCategory,
        failed_fields: validationError.inner?.map((err) => err.path) || [],
        total_errors: validationError.inner?.length || 0,
        requestId,
        templateId: id,
      });

      captureMessage('Template validation failed with Yup schema', {
        level: 'warning',
        tags: {
          component: 'templates',
          action: 'yup_validation_failed',
          error_category: 'validation',
          entity: 'template',
          operation: 'update',
        },
        extra: {
          requestId,
          templateId: id,
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
      const headers = createResponseHeaders(requestId, responseTime, id);

      return NextResponse.json({ errors }, { status: 400, headers });
    }

    // ===== ÉTAPE 8: GESTION DE L'IMAGE CLOUDINARY =====
    if (
      oldImageId &&
      sanitizedTemplateImageId &&
      oldImageId !== sanitizedTemplateImageId
    ) {
      try {
        await cloudinary.uploader.destroy(oldImageId);
      } catch (cloudError) {
        logger.error('Error deleting old image from Cloudinary', {
          requestId,
          templateId: id,
          oldImageId,
          error: cloudError.message,
        });

        captureException(cloudError, {
          level: 'warning',
          tags: {
            component: 'templates',
            action: 'cloudinary_delete_failed',
            error_category: 'media_upload',
            entity: 'template',
            operation: 'update',
          },
          extra: {
            requestId,
            templateId: id,
            oldImageId,
          },
        });
      }
    }

    // ===== ÉTAPE 9: MISE À JOUR EN BASE DE DONNÉES =====
    let result;
    try {
      const updateFields = [];
      const updateValues = [];
      let paramCounter = 1;

      if (sanitizedTemplateName !== undefined) {
        updateFields.push(`template_name = $${paramCounter}`);
        updateValues.push(sanitizedTemplateName);
        paramCounter++;
      }

      if (sanitizedTemplateImageId !== undefined) {
        updateFields.push(`template_image = $${paramCounter}`);
        updateValues.push(sanitizedTemplateImageId);
        paramCounter++;
      }

      if (sanitizedTemplateColor !== undefined) {
        updateFields.push(`template_color = $${paramCounter}`);
        updateValues.push(sanitizedTemplateColor);
        paramCounter++;
      }

      if (sanitizedTemplateHasWeb !== undefined) {
        updateFields.push(`template_has_web = $${paramCounter}`);
        updateValues.push(sanitizedTemplateHasWeb);
        paramCounter++;
      }

      if (sanitizedTemplateHasMobile !== undefined) {
        updateFields.push(`template_has_mobile = $${paramCounter}`);
        updateValues.push(sanitizedTemplateHasMobile);
        paramCounter++;
      }

      if (isActive !== undefined) {
        updateFields.push(`is_active = $${paramCounter}`);
        updateValues.push(isActive);
        paramCounter++;
      }

      updateValues.push(id);

      const queryText = `
        UPDATE catalog.templates 
        SET ${updateFields.join(', ')}
        WHERE template_id = $${paramCounter}
        RETURNING *
      `;

      result = await client.query(queryText, updateValues);

      if (result.rows.length === 0) {
        logger.warn('Template not found for update', {
          requestId,
          templateId: id,
        });

        captureMessage('Template not found for update', {
          level: 'warning',
          tags: {
            component: 'templates',
            action: 'template_not_found',
            error_category: 'not_found',
            entity: 'template',
            operation: 'update',
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
          { message: 'Template not found' },
          { status: 404, headers },
        );
      }
    } catch (updateError) {
      const errorCategory = categorizeError(updateError);

      logger.error('Template Update Error', {
        category: errorCategory,
        message: updateError.message,
        requestId,
        templateId: id,
      });

      captureDatabaseError(updateError, {
        tags: {
          component: 'templates',
          action: 'update_failed',
          operation: 'UPDATE',
          entity: 'template',
        },
        extra: {
          requestId,
          templateId: id,
          table: 'catalog.templates',
          queryType: 'template_update',
          postgresCode: updateError.code,
          postgresDetail: updateError.detail ? '[Filtered]' : undefined,
          ip: anonymizeIp(extractRealIp(request)),
          rateLimitingApplied: true,
        },
      });

      if (client) await client.cleanup();

      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(requestId, responseTime, id);

      return NextResponse.json(
        { error: 'Failed to update template', message: updateError.message },
        { status: 500, headers },
      );
    }

    // ===== ÉTAPE 10: INVALIDATION DU CACHE APRÈS SUCCÈS =====
    const updatedTemplate = result.rows[0];

    invalidateTemplatesCache(requestId, id);

    // ===== ÉTAPE 11: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Template update successful', {
      templateId: id,
      templateName: updatedTemplate.template_name,
      response_time_ms: responseTime,
      success: true,
      requestId,
    });

    captureMessage('Template update completed successfully', {
      level: 'info',
      tags: {
        component: 'templates',
        action: 'update_success',
        success: 'true',
        entity: 'template',
        operation: 'update',
      },
      extra: {
        requestId,
        templateId: id,
        templateName: updatedTemplate.template_name,
        templateColor: updatedTemplate.template_color,
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

    const headers = createResponseHeaders(requestId, responseTime, id);

    return NextResponse.json(
      {
        message: 'Template updated successfully',
        template: updatedTemplate,
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

    logger.error('Global Edit Template Error', {
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
        operation: 'update',
      },
      extra: {
        requestId,
        templateId: id,
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'template_update',
        ip: anonymizeIp(extractRealIp(request)),
        rateLimitingApplied: true,
      },
    });

    if (client) await client.cleanup();

    const headers = createResponseHeaders(requestId, responseTime, id);

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: 'Failed to update template',
        requestId,
      },
      {
        status: 500,
        headers: headers,
      },
    );
  }
}
