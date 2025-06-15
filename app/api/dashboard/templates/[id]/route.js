// app/api/dashboard/templates/[id]/route.js
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
import { templateIdSchema, cleanUUID } from '@/utils/schemas/templateSchema';

// ----- CONFIGURATION DU RATE LIMITING POUR LA RÉCUPÉRATION D'UN TEMPLATE -----

// Créer le middleware de rate limiting spécifique pour la récupération d'un template
const getTemplateByIdRateLimit = applyRateLimit('AUTHENTICATED_API', {
  // Configuration personnalisée pour la récupération d'un template
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // 60 requêtes par minute (plus généreux pour les APIs de lecture d'un élément)
  message:
    'Trop de requêtes pour récupérer des templates. Veuillez réessayer dans quelques instants.',
  skipSuccessfulRequests: false, // Compter toutes les requêtes réussies
  skipFailedRequests: false, // Compter aussi les échecs
  prefix: 'get_template_by_id', // Préfixe spécifique pour la récupération d'un template

  // Fonction personnalisée pour générer la clé (basée sur IP)
  keyGenerator: (req) => {
    const ip = extractRealIp(req);
    return `get_template_by_id:ip:${ip}`;
  },
});

// ----- API ROUTE PRINCIPALE AVEC RATE LIMITING ET MONITORING SENTRY -----

export async function GET(req, { params }) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();
  const { id } = params;

  logger.info('Get Template By ID API called', {
    timestamp: new Date().toISOString(),
    requestId,
    component: 'templates',
    action: 'api_start',
    method: 'GET',
    operation: 'get_template_by_id',
    templateId: id,
  });

  // Capturer le début du processus de récupération d'un template
  captureMessage('Get template by ID process started', {
    level: 'info',
    tags: {
      component: 'templates',
      action: 'process_start',
      api_endpoint: '/api/dashboard/templates/[id]',
      entity: 'template',
      operation: 'read',
    },
    extra: {
      requestId,
      templateId: id,
      timestamp: new Date().toISOString(),
      method: 'GET',
    },
  });

  try {
    // ===== ÉTAPE 1: APPLIQUER LE RATE LIMITING =====
    logger.debug('Applying rate limiting for get template by ID API', {
      requestId,
      component: 'templates',
      action: 'rate_limit_start',
      operation: 'get_template_by_id',
      templateId: id,
    });

    const rateLimitResponse = await getTemplateByIdRateLimit(req);

    // Si le rate limiter retourne une réponse, cela signifie que la limite est dépassée
    if (rateLimitResponse) {
      logger.warn('Get template by ID API rate limit exceeded', {
        requestId,
        component: 'templates',
        action: 'rate_limit_exceeded',
        operation: 'get_template_by_id',
        templateId: id,
        ip: anonymizeIp(extractRealIp(req)),
      });

      // Capturer l'événement de rate limiting avec Sentry
      captureMessage('Get template by ID API rate limit exceeded', {
        level: 'warning',
        tags: {
          component: 'templates',
          action: 'rate_limit_exceeded',
          error_category: 'rate_limiting',
          entity: 'template',
          operation: 'read',
        },
        extra: {
          requestId,
          templateId: id,
          ip: anonymizeIp(extractRealIp(req)),
          userAgent:
            req.headers.get('user-agent')?.substring(0, 100) || 'unknown',
        },
      });

      return rateLimitResponse; // Retourner directement la réponse 429
    }

    logger.debug('Rate limiting passed successfully', {
      requestId,
      component: 'templates',
      action: 'rate_limit_passed',
      operation: 'get_template_by_id',
      templateId: id,
    });

    // ===== ÉTAPE 2: VÉRIFICATION AUTHENTIFICATION =====
    logger.debug('Verifying user authentication', {
      requestId,
      component: 'templates',
      action: 'auth_verification_start',
      operation: 'get_template_by_id',
      templateId: id,
    });

    await isAuthenticatedUser(req, NextResponse);

    logger.debug('User authentication verified successfully', {
      requestId,
      component: 'templates',
      action: 'auth_verification_success',
      operation: 'get_template_by_id',
      templateId: id,
    });

    // ===== ÉTAPE 3: VALIDATION DE L'ID AVEC YUP =====
    logger.debug('Validating template ID with Yup schema', {
      requestId,
      component: 'templates',
      action: 'id_validation_start',
      operation: 'get_template_by_id',
      providedId: id,
    });

    try {
      // Valider l'ID avec le schema Yup
      await templateIdSchema.validate({ id }, { abortEarly: false });

      logger.debug('Template ID validation with Yup passed', {
        requestId,
        component: 'templates',
        action: 'yup_id_validation_success',
        operation: 'get_template_by_id',
        templateId: id,
      });
    } catch (validationError) {
      const errorCategory = categorizeError(validationError);

      logger.warn('Template ID validation failed with Yup', {
        category: errorCategory,
        providedId: id,
        failed_fields: validationError.inner?.map((err) => err.path) || [],
        total_errors: validationError.inner?.length || 0,
        requestId,
        component: 'templates',
        action: 'yup_id_validation_failed',
        operation: 'get_template_by_id',
      });

      // Capturer l'erreur de validation avec Sentry
      captureMessage('Template ID validation failed with Yup schema', {
        level: 'warning',
        tags: {
          component: 'templates',
          action: 'yup_id_validation_failed',
          error_category: 'validation',
          entity: 'template',
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
    const cleanedTemplateId = cleanUUID(id);
    if (!cleanedTemplateId) {
      logger.warn('Template ID cleaning failed', {
        requestId,
        component: 'templates',
        action: 'id_cleaning_failed',
        operation: 'get_template_by_id',
        providedId: id,
      });

      return NextResponse.json(
        { error: 'Invalid template ID format' },
        { status: 400 },
      );
    }

    logger.debug('Template ID validation and cleaning passed', {
      requestId,
      component: 'templates',
      action: 'id_validation_success',
      operation: 'get_template_by_id',
      originalId: id,
      cleanedId: cleanedTemplateId,
    });

    // ===== ÉTAPE 4: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
      logger.debug('Database connection successful', {
        requestId,
        component: 'templates',
        action: 'db_connection_success',
        operation: 'get_template_by_id',
        templateId: cleanedTemplateId,
      });
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Database Connection Error during template fetch by ID', {
        category: errorCategory,
        message: dbConnectionError.message,
        timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
        requestId,
        component: 'templates',
        action: 'db_connection_failed',
        operation: 'get_template_by_id',
        templateId: cleanedTemplateId,
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
          templateId: cleanedTemplateId,
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
      // Note: Correction de la typo "catalohg" vers "catalog"
      const templateQuery = `
        SELECT 
          template_id,
          template_name,
          template_image,
          template_has_web,
          template_has_mobile,
          template_added,
          sales_count,
          is_active,
          updated_at
        FROM catalog.templates 
        WHERE template_id = $1
      `;

      logger.debug('Executing template fetch by ID query', {
        requestId,
        component: 'templates',
        action: 'query_start',
        operation: 'get_template_by_id',
        templateId: cleanedTemplateId,
        table: 'catalog.templates',
      });

      result = await client.query(templateQuery, [cleanedTemplateId]);

      logger.debug('Template fetch by ID query executed successfully', {
        requestId,
        component: 'templates',
        action: 'query_success',
        operation: 'get_template_by_id',
        templateId: cleanedTemplateId,
        rowCount: result.rows.length,
      });
    } catch (queryError) {
      const errorCategory = categorizeError(queryError);

      logger.error('Template Fetch By ID Query Error', {
        category: errorCategory,
        message: queryError.message,
        query: 'template_fetch_by_id',
        table: 'catalog.templates',
        templateId: cleanedTemplateId,
        requestId,
        component: 'templates',
        action: 'query_failed',
        operation: 'get_template_by_id',
      });

      // Capturer l'erreur de requête avec Sentry
      captureDatabaseError(queryError, {
        tags: {
          component: 'templates',
          action: 'query_failed',
          operation: 'SELECT',
          entity: 'template',
        },
        extra: {
          requestId,
          templateId: cleanedTemplateId,
          table: 'catalog.templates',
          queryType: 'template_fetch_by_id',
          postgresCode: queryError.code,
          postgresDetail: queryError.detail ? '[Filtered]' : undefined,
          ip: anonymizeIp(extractRealIp(req)),
          rateLimitingApplied: true,
        },
      });

      if (client) await client.cleanup();
      return NextResponse.json(
        { error: 'Failed to fetch template from database' },
        { status: 500 },
      );
    }

    // ===== ÉTAPE 6: VÉRIFICATION EXISTENCE DU TEMPLATE =====
    if (result.rows.length === 0) {
      logger.warn('Template not found', {
        requestId,
        component: 'templates',
        action: 'template_not_found',
        operation: 'get_template_by_id',
        templateId: cleanedTemplateId,
      });

      // Capturer le template non trouvé avec Sentry
      captureMessage('Template not found', {
        level: 'warning',
        tags: {
          component: 'templates',
          action: 'template_not_found',
          error_category: 'business_logic',
          entity: 'template',
          operation: 'read',
        },
        extra: {
          requestId,
          templateId: cleanedTemplateId,
          ip: anonymizeIp(extractRealIp(req)),
        },
      });

      if (client) await client.cleanup();
      return NextResponse.json(
        { message: 'Template not found' },
        { status: 404 },
      );
    }

    // ===== ÉTAPE 7: FORMATAGE DES DONNÉES =====
    const template = result.rows[0];
    const sanitizedTemplate = {
      template_id: template.template_id,
      template_name: template.template_name || '[No Name]',
      template_image: template.template_image,
      template_has_web: Boolean(template.template_has_web),
      template_has_mobile: Boolean(template.template_has_mobile),
      template_added: template.template_added,
      sales_count: parseInt(template.sales_count) || 0,
      is_active: Boolean(template.is_active),
      updated_at: template.updated_at,
    };

    logger.debug('Template data sanitized', {
      requestId,
      component: 'templates',
      action: 'data_sanitization',
      operation: 'get_template_by_id',
      templateId: cleanedTemplateId,
    });

    // ===== ÉTAPE 8: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Template fetch by ID successful', {
      templateId: cleanedTemplateId,
      templateName: sanitizedTemplate.template_name,
      response_time_ms: responseTime,
      database_operations: 2, // connection + query
      success: true,
      requestId,
      component: 'templates',
      action: 'fetch_by_id_success',
      entity: 'template',
      rateLimitingApplied: true,
      operation: 'get_template_by_id',
      yupValidationApplied: true,
    });

    // Capturer le succès de la récupération avec Sentry
    captureMessage('Template fetch by ID completed successfully', {
      level: 'info',
      tags: {
        component: 'templates',
        action: 'fetch_by_id_success',
        success: 'true',
        entity: 'template',
        operation: 'read',
      },
      extra: {
        requestId,
        templateId: cleanedTemplateId,
        templateName: sanitizedTemplate.template_name,
        responseTimeMs: responseTime,
        databaseOperations: 2,
        ip: anonymizeIp(extractRealIp(req)),
        rateLimitingApplied: true,
      },
    });

    if (client) await client.cleanup();

    return NextResponse.json(
      {
        template: sanitizedTemplate,
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

    logger.error('Global Get Template By ID Error', {
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
      operation: 'get_template_by_id',
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
        operation: 'read',
      },
      extra: {
        requestId,
        templateId: id,
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'template_fetch_by_id',
        ip: anonymizeIp(extractRealIp(req)),
        rateLimitingApplied: true,
      },
    });

    if (client) await client.cleanup();

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: 'Failed to fetch template',
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
