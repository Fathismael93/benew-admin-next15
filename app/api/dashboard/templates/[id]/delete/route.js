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

      return NextResponse.json(
        {
          success: false,
          error: 'Invalid template ID format',
          message: 'This template does not exist',
          details: idValidationError.inner?.map((err) => err.message) || [
            idValidationError.message,
          ],
        },
        { status: 400 },
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

      return rateLimitResponse; // Retourner directement la réponse 429
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

      return NextResponse.json(
        {
          success: false,
          error: 'Database connection failed',
        },
        { status: 503 },
      );
    }

    // ===== ÉTAPE 5: PARSING ET VALIDATION DU BODY =====
    let body;
    let imageID;

    try {
      body = await request.json();
      imageID = body.imageID;

      logger.debug('Request body parsed successfully', {
        requestId,
        templateId: id,
        component: 'templates',
        action: 'body_parse_success',
        operation: 'delete_template',
        hasImageID: !!imageID,
      });
    } catch (parseError) {
      const errorCategory = categorizeError(parseError);

      logger.error('JSON Parse Error during template deletion', {
        category: errorCategory,
        message: parseError.message,
        requestId,
        templateId: id,
        component: 'templates',
        action: 'json_parse_error',
        operation: 'delete_template',
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
          operation: 'delete',
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
        {
          success: false,
          error: 'Invalid JSON in request body',
          message: 'Invalid request format',
        },
        { status: 400 },
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
        return NextResponse.json(
          {
            success: false,
            message: 'This template does not exist',
          },
          { status: 404 },
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
        return NextResponse.json(
          {
            success: false,
            message:
              'Cannot delete active template. Please deactivate the template first.',
            error: 'Template is currently active',
          },
          { status: 400 },
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
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to verify template status',
          message: 'Something went wrong! Please try again',
        },
        { status: 500 },
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
        'DELETE FROM catalog.templates WHERE template_id = $1 AND is_active = false RETURNING template_name, template_image',
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
        return NextResponse.json(
          {
            success: false,
            message:
              'Template could not be deleted. It may be active or already deleted.',
            error: 'Deletion condition not met',
          },
          { status: 400 },
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
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to delete template from database',
          message: 'Something went wrong! Please try again',
        },
        { status: 500 },
      );
    }

    // ===== ÉTAPE 8: SUPPRESSION DE L'IMAGE CLOUDINARY =====
    const deletedTemplate = deleteResult.rows[0];
    const cloudinaryImageId = imageID || deletedTemplate.template_image;

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

    // ===== ÉTAPE 9: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Template deletion successful', {
      templateId: id,
      templateName: deletedTemplate.template_name,
      imageId: cloudinaryImageId,
      response_time_ms: responseTime,
      database_operations: 3, // connection + check + delete
      cloudinary_operations: cloudinaryImageId ? 1 : 0,
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
        ip: anonymizeIp(extractRealIp(request)),
        rateLimitingApplied: true,
      },
    });

    if (client) await client.cleanup();

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
