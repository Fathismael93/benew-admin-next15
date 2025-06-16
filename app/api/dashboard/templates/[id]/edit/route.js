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
// AJOUT POUR L'INVALIDATION DU CACHE
import { dashboardCache, getDashboardCacheKey } from '@/utils/cache';

// ----- CONFIGURATION DU RATE LIMITING POUR LA MODIFICATION DE TEMPLATES -----

// Créer le middleware de rate limiting spécifique pour la modification de templates
const editTemplateRateLimit = applyRateLimit('CONTENT_API', {
  // Configuration personnalisée pour la modification de templates
  windowMs: 2 * 60 * 1000, // 2 minutes
  max: 20, // 20 modifications par 2 minutes (plus permissif que l'ajout)
  message:
    'Trop de tentatives de modification de templates. Veuillez réessayer dans quelques minutes.',
  skipSuccessfulRequests: false, // Compter toutes les modifications réussies
  skipFailedRequests: false, // Compter aussi les échecs
  prefix: 'edit_template', // Préfixe spécifique pour la modification de templates

  // Fonction personnalisée pour générer la clé (basée sur IP + ID du template)
  keyGenerator: (req) => {
    const ip = extractRealIp(req);
    const url = req.url || req.nextUrl?.pathname || '';
    const templateIdMatch = url.match(/templates\/([^/]+)\/edit/);
    const templateId = templateIdMatch ? templateIdMatch[1] : 'unknown';
    return `edit_template:ip:${ip}:template:${templateId}`;
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
      operation: 'edit_template',
      cacheKey,
      invalidated: cacheInvalidated,
    });

    // Capturer l'invalidation du cache avec Sentry
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
      component: 'templates',
      action: 'cache_invalidation_failed',
      operation: 'edit_template',
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

// ----- API ROUTE PRINCIPALE AVEC RATE LIMITING -----

export async function PUT(request, { params }) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();
  const { id } = params;

  logger.info('Edit Template API called', {
    timestamp: new Date().toISOString(),
    requestId,
    templateId: id,
    component: 'templates',
    action: 'api_start',
    method: 'PUT',
    operation: 'edit_template',
  });

  // Capturer le début du processus de modification de template
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
    logger.debug('Validating template ID', {
      requestId,
      templateId: id,
      component: 'templates',
      action: 'id_validation_start',
      operation: 'edit_template',
    });

    try {
      await templateIdSchema.validate({ id }, { abortEarly: false });

      logger.debug('Template ID validation passed', {
        requestId,
        templateId: id,
        component: 'templates',
        action: 'id_validation_success',
        operation: 'edit_template',
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
        operation: 'edit_template',
      });

      // Capturer l'erreur de validation d'ID avec Sentry
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

      return NextResponse.json(
        {
          error: 'Invalid template ID format',
          details: idValidationError.inner?.map((err) => err.message) || [
            idValidationError.message,
          ],
        },
        { status: 400 },
      );
    }

    // ===== ÉTAPE 2: APPLIQUER LE RATE LIMITING =====
    logger.debug('Applying rate limiting for edit template API', {
      requestId,
      templateId: id,
      component: 'templates',
      action: 'rate_limit_start',
      operation: 'edit_template',
    });

    const rateLimitResponse = await editTemplateRateLimit(request);

    // Si le rate limiter retourne une réponse, cela signifie que la limite est dépassée
    if (rateLimitResponse) {
      logger.warn('Edit template API rate limit exceeded', {
        requestId,
        templateId: id,
        component: 'templates',
        action: 'rate_limit_exceeded',
        operation: 'edit_template',
        ip: anonymizeIp(extractRealIp(request)),
      });

      // Capturer l'événement de rate limiting avec Sentry
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

      return rateLimitResponse; // Retourner directement la réponse 429
    }

    logger.debug('Rate limiting passed successfully', {
      requestId,
      templateId: id,
      component: 'templates',
      action: 'rate_limit_passed',
      operation: 'edit_template',
    });

    // ===== ÉTAPE 3: VÉRIFICATION AUTHENTIFICATION =====
    logger.debug('Verifying user authentication', {
      requestId,
      templateId: id,
      component: 'templates',
      action: 'auth_verification_start',
      operation: 'edit_template',
    });

    await isAuthenticatedUser(request, NextResponse);

    logger.debug('User authentication verified successfully', {
      requestId,
      templateId: id,
      component: 'templates',
      action: 'auth_verification_success',
      operation: 'edit_template',
    });

    // ===== ÉTAPE 4: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
      logger.debug('Database connection successful', {
        requestId,
        templateId: id,
        component: 'templates',
        action: 'db_connection_success',
        operation: 'edit_template',
      });
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Database Connection Error during template edit', {
        category: errorCategory,
        message: dbConnectionError.message,
        timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
        requestId,
        templateId: id,
        component: 'templates',
        action: 'db_connection_failed',
        operation: 'edit_template',
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

      return NextResponse.json(
        { error: 'Database connection failed' },
        { status: 503 },
      );
    }

    // ===== ÉTAPE 5: PARSING ET VALIDATION DU BODY =====
    let body;
    try {
      body = await request.json();
      logger.debug('Request body parsed successfully', {
        requestId,
        templateId: id,
        component: 'templates',
        action: 'body_parse_success',
        operation: 'edit_template',
      });
    } catch (parseError) {
      const errorCategory = categorizeError(parseError);

      logger.error('JSON Parse Error during template edit', {
        category: errorCategory,
        message: parseError.message,
        requestId,
        templateId: id,
        component: 'templates',
        action: 'json_parse_error',
        operation: 'edit_template',
        headers: {
          'content-type': request.headers.get('content-type'),
          'user-agent': request.headers.get('user-agent')?.substring(0, 100),
        },
      });

      // Capturer l'erreur de parsing avec Sentry
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
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 },
      );
    }

    const {
      templateName,
      templateImageId,
      templateHasWeb,
      templateHasMobile,
      isActive,
      oldImageId,
    } = body;

    logger.debug('Template data extracted from request', {
      requestId,
      templateId: id,
      component: 'templates',
      action: 'data_extraction',
      operation: 'edit_template',
      hasTemplateName: !!templateName,
      hasTemplateImageId: !!templateImageId,
      hasIsActive: isActive !== undefined,
      hasOldImageId: !!oldImageId,
    });

    // ===== ÉTAPE 6: SANITIZATION DES INPUTS (SAUF isActive) =====
    logger.debug('Sanitizing template inputs', {
      requestId,
      templateId: id,
      component: 'templates',
      action: 'input_sanitization',
      operation: 'edit_template',
    });

    // Préparer les données pour la sanitization (exclure isActive)
    const dataToSanitize = {
      templateName,
      templateImageId,
      templateHasWeb,
      templateHasMobile,
    };

    // Filtrer les valeurs undefined pour la sanitization
    const filteredDataToSanitize = Object.fromEntries(
      Object.entries(dataToSanitize).filter(
        ([_, value]) => value !== undefined,
      ),
    );

    const sanitizedInputs = sanitizeTemplateInputsStrict(
      filteredDataToSanitize,
    );

    // Récupérer les données sanitizées et ajouter isActive non sanitizé
    const {
      templateName: sanitizedTemplateName,
      templateImageId: sanitizedTemplateImageId,
      templateHasWeb: sanitizedTemplateHasWeb,
      templateHasMobile: sanitizedTemplateHasMobile,
    } = sanitizedInputs;

    // isActive n'est pas sanitizé selon vos instructions
    const finalData = {
      templateName: sanitizedTemplateName,
      templateImageId: sanitizedTemplateImageId,
      templateHasWeb: sanitizedTemplateHasWeb,
      templateHasMobile: sanitizedTemplateHasMobile,
      isActive, // Non sanitizé
      oldImageId, // Non sanitizé car utilisé pour la logique interne
    };

    logger.debug('Input sanitization completed', {
      requestId,
      templateId: id,
      component: 'templates',
      action: 'input_sanitization_completed',
      operation: 'edit_template',
    });

    // ===== ÉTAPE 7: VALIDATION AVEC YUP =====
    try {
      // Filtrer les champs undefined pour la validation
      const dataToValidate = Object.fromEntries(
        Object.entries({
          templateName: sanitizedTemplateName,
          templateImageId: sanitizedTemplateImageId,
          templateHasWeb: sanitizedTemplateHasWeb,
          templateHasMobile: sanitizedTemplateHasMobile,
          isActive,
        }).filter(([_, value]) => value !== undefined),
      );

      // Valider les données avec le schema Yup pour les mises à jour
      await templateUpdateSchema.validate(dataToValidate, {
        abortEarly: false,
      });

      logger.debug('Template validation with Yup passed', {
        requestId,
        templateId: id,
        component: 'templates',
        action: 'yup_validation_success',
        operation: 'edit_template',
      });
    } catch (validationError) {
      const errorCategory = categorizeError(validationError);

      logger.error('Template Validation Error with Yup', {
        category: errorCategory,
        failed_fields: validationError.inner?.map((err) => err.path) || [],
        total_errors: validationError.inner?.length || 0,
        requestId,
        templateId: id,
        component: 'templates',
        action: 'yup_validation_failed',
        operation: 'edit_template',
      });

      // Capturer l'erreur de validation avec Sentry
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

      return NextResponse.json({ errors }, { status: 400 });
    }

    // ===== ÉTAPE 8: GESTION DE L'IMAGE CLOUDINARY =====
    // Si l'image a changé, supprimer l'ancienne image de Cloudinary
    if (
      oldImageId &&
      sanitizedTemplateImageId &&
      oldImageId !== sanitizedTemplateImageId
    ) {
      try {
        logger.debug('Deleting old image from Cloudinary', {
          requestId,
          templateId: id,
          oldImageId,
          component: 'templates',
          action: 'cloudinary_delete_start',
          operation: 'edit_template',
        });

        await cloudinary.uploader.destroy(oldImageId);

        logger.debug('Old image deleted from Cloudinary successfully', {
          requestId,
          templateId: id,
          oldImageId,
          component: 'templates',
          action: 'cloudinary_delete_success',
          operation: 'edit_template',
        });
      } catch (cloudError) {
        logger.error('Error deleting old image from Cloudinary', {
          requestId,
          templateId: id,
          oldImageId,
          error: cloudError.message,
          component: 'templates',
          action: 'cloudinary_delete_failed',
          operation: 'edit_template',
        });

        // Capturer l'erreur Cloudinary avec Sentry (non critique)
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
        // Ne pas arrêter le processus pour une erreur Cloudinary
      }
    }

    // ===== ÉTAPE 9: MISE À JOUR EN BASE DE DONNÉES =====
    let result;
    try {
      // Construire la requête dynamiquement selon les champs fournis
      const updateFields = [];
      const updateValues = [];
      let paramCounter = 1;

      if (sanitizedTemplateName !== undefined) {
        updateFields.push(`template_name = ${paramCounter}`);
        updateValues.push(sanitizedTemplateName);
        paramCounter++;
      }

      if (sanitizedTemplateImageId !== undefined) {
        updateFields.push(`template_image = ${paramCounter}`);
        updateValues.push(sanitizedTemplateImageId);
        paramCounter++;
      }

      if (sanitizedTemplateHasWeb !== undefined) {
        updateFields.push(`template_has_web = ${paramCounter}`);
        updateValues.push(sanitizedTemplateHasWeb);
        paramCounter++;
      }

      if (sanitizedTemplateHasMobile !== undefined) {
        updateFields.push(`template_has_mobile = ${paramCounter}`);
        updateValues.push(sanitizedTemplateHasMobile);
        paramCounter++;
      }

      if (isActive !== undefined) {
        updateFields.push(`is_active = ${paramCounter}`);
        updateValues.push(isActive);
        paramCounter++;
      }

      // Ajouter l'ID du template à la fin
      updateValues.push(id);

      const queryText = `
        UPDATE catalog.templates 
        SET ${updateFields.join(', ')}
        WHERE template_id = ${paramCounter}
        RETURNING *
      `;

      logger.debug('Executing template update query', {
        requestId,
        templateId: id,
        component: 'templates',
        action: 'query_start',
        operation: 'edit_template',
        table: 'catalog.templates',
        fieldsToUpdate: updateFields.length,
      });

      result = await client.query(queryText, updateValues);

      if (result.rows.length === 0) {
        logger.warn('Template not found for update', {
          requestId,
          templateId: id,
          component: 'templates',
          action: 'template_not_found',
          operation: 'edit_template',
        });

        // Capturer le template non trouvé avec Sentry
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
        return NextResponse.json(
          { message: 'Template not found' },
          { status: 404 },
        );
      }

      logger.debug('Template update query executed successfully', {
        requestId,
        templateId: id,
        component: 'templates',
        action: 'query_success',
        operation: 'edit_template',
        updatedFields: updateFields.length,
      });
    } catch (updateError) {
      const errorCategory = categorizeError(updateError);

      logger.error('Template Update Error', {
        category: errorCategory,
        message: updateError.message,
        operation: 'UPDATE catalog.templates',
        table: 'catalog.templates',
        requestId,
        templateId: id,
        component: 'templates',
        action: 'query_failed',
      });

      // Capturer l'erreur de mise à jour avec Sentry
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
      return NextResponse.json(
        { error: 'Failed to update template', message: updateError.message },
        { status: 500 },
      );
    }

    // ===== ÉTAPE 10: INVALIDATION DU CACHE APRÈS SUCCÈS =====
    const updatedTemplate = result.rows[0];

    // Invalider le cache des templates après modification réussie
    invalidateTemplatesCache(requestId, id);

    // ===== ÉTAPE 11: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Template update successful', {
      templateId: id,
      templateName: updatedTemplate.template_name,
      response_time_ms: responseTime,
      database_operations: 2, // connection + update
      cache_invalidated: true,
      success: true,
      requestId,
      component: 'templates',
      action: 'update_success',
      entity: 'template',
      rateLimitingApplied: true,
      operation: 'edit_template',
      sanitizationApplied: true,
      yupValidationApplied: true,
    });

    // Capturer le succès de la mise à jour avec Sentry
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

    logger.error('Global Edit Template Error', {
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
      operation: 'edit_template',
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

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: 'Failed to update template',
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
