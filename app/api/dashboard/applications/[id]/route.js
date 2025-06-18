// app/api/dashboard/applications/[id]/route.js
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
import applicationIdSchema, {
  cleanUUID,
} from '@/utils/schemas/applicationSchema';

// ----- CONFIGURATION DU RATE LIMITING POUR LA RÉCUPÉRATION D'UNE APPLICATION -----

// Créer le middleware de rate limiting spécifique pour la récupération d'une application
const getApplicationByIdRateLimit = applyRateLimit('AUTHENTICATED_API', {
  // Configuration personnalisée pour la récupération d'une application
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // 60 requêtes par minute (généreux pour les APIs de lecture)
  message:
    'Trop de requêtes pour récupérer des applications. Veuillez réessayer dans quelques instants.',
  skipSuccessfulRequests: false, // Compter toutes les requêtes réussies
  skipFailedRequests: false, // Compter aussi les échecs
  prefix: 'get_application_by_id', // Préfixe spécifique pour la récupération d'application

  // Fonction personnalisée pour générer la clé (basée sur IP)
  keyGenerator: (req) => {
    const ip = extractRealIp(req);
    return `get_application_by_id:ip:${ip}`;
  },
});

// ----- API ROUTE PRINCIPALE AVEC RATE LIMITING ET MONITORING SENTRY -----

export async function GET(req, { params }) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();
  const { id } = params;

  logger.info('Get Application By ID API called', {
    timestamp: new Date().toISOString(),
    requestId,
    component: 'applications',
    action: 'api_start',
    method: 'GET',
    operation: 'get_application_by_id',
    applicationId: id,
  });

  // Capturer le début du processus de récupération d'une application
  captureMessage('Get application by ID process started', {
    level: 'info',
    tags: {
      component: 'applications',
      action: 'process_start',
      api_endpoint: '/api/dashboard/applications/[id]',
      entity: 'application',
      operation: 'read',
    },
    extra: {
      requestId,
      applicationId: id,
      timestamp: new Date().toISOString(),
      method: 'GET',
    },
  });

  try {
    // ===== ÉTAPE 1: APPLIQUER LE RATE LIMITING =====
    logger.debug('Applying rate limiting for get application by ID API', {
      requestId,
      component: 'applications',
      action: 'rate_limit_start',
      operation: 'get_application_by_id',
      applicationId: id,
    });

    const rateLimitResponse = await getApplicationByIdRateLimit(req);

    // Si le rate limiter retourne une réponse, cela signifie que la limite est dépassée
    if (rateLimitResponse) {
      logger.warn('Get application by ID API rate limit exceeded', {
        requestId,
        component: 'applications',
        action: 'rate_limit_exceeded',
        operation: 'get_application_by_id',
        applicationId: id,
        ip: anonymizeIp(extractRealIp(req)),
      });

      // Capturer l'événement de rate limiting avec Sentry
      captureMessage('Get application by ID API rate limit exceeded', {
        level: 'warning',
        tags: {
          component: 'applications',
          action: 'rate_limit_exceeded',
          error_category: 'rate_limiting',
          entity: 'application',
          operation: 'read',
        },
        extra: {
          requestId,
          applicationId: id,
          ip: anonymizeIp(extractRealIp(req)),
          userAgent:
            req.headers.get('user-agent')?.substring(0, 100) || 'unknown',
        },
      });

      return rateLimitResponse; // Retourner directement la réponse 429
    }

    logger.debug('Rate limiting passed successfully', {
      requestId,
      component: 'applications',
      action: 'rate_limit_passed',
      operation: 'get_application_by_id',
      applicationId: id,
    });

    // ===== ÉTAPE 2: VÉRIFICATION AUTHENTIFICATION =====
    logger.debug('Verifying user authentication', {
      requestId,
      component: 'applications',
      action: 'auth_verification_start',
      operation: 'get_application_by_id',
      applicationId: id,
    });

    await isAuthenticatedUser(req, NextResponse);

    logger.debug('User authentication verified successfully', {
      requestId,
      component: 'applications',
      action: 'auth_verification_success',
      operation: 'get_application_by_id',
      applicationId: id,
    });

    // ===== ÉTAPE 3: VALIDATION DE L'ID AVEC YUP =====
    logger.debug('Validating application ID with Yup schema', {
      requestId,
      component: 'applications',
      action: 'id_validation_start',
      operation: 'get_application_by_id',
      providedId: id,
    });

    try {
      // Valider l'ID avec le schema Yup
      await applicationIdSchema.validate({ id }, { abortEarly: false });

      logger.debug('Application ID validation with Yup passed', {
        requestId,
        component: 'applications',
        action: 'yup_id_validation_success',
        operation: 'get_application_by_id',
        applicationId: id,
      });
    } catch (validationError) {
      const errorCategory = categorizeError(validationError);

      logger.warn('Application ID validation failed with Yup', {
        category: errorCategory,
        providedId: id,
        failed_fields: validationError.inner?.map((err) => err.path) || [],
        total_errors: validationError.inner?.length || 0,
        requestId,
        component: 'applications',
        action: 'yup_id_validation_failed',
        operation: 'get_application_by_id',
      });

      // Capturer l'erreur de validation avec Sentry
      captureMessage('Application ID validation failed with Yup schema', {
        level: 'warning',
        tags: {
          component: 'applications',
          action: 'yup_id_validation_failed',
          error_category: 'validation',
          entity: 'application',
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
    const cleanedApplicationId = cleanUUID(id);
    if (!cleanedApplicationId) {
      logger.warn('Application ID cleaning failed', {
        requestId,
        component: 'applications',
        action: 'id_cleaning_failed',
        operation: 'get_application_by_id',
        providedId: id,
      });

      return NextResponse.json(
        { error: 'Invalid application ID format' },
        { status: 400 },
      );
    }

    logger.debug('Application ID validation and cleaning passed', {
      requestId,
      component: 'applications',
      action: 'id_validation_success',
      operation: 'get_application_by_id',
      originalId: id,
      cleanedId: cleanedApplicationId,
    });

    // ===== ÉTAPE 4: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
      logger.debug('Database connection successful', {
        requestId,
        component: 'applications',
        action: 'db_connection_success',
        operation: 'get_application_by_id',
        applicationId: cleanedApplicationId,
      });
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Database Connection Error during application fetch by ID', {
        category: errorCategory,
        message: dbConnectionError.message,
        timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
        requestId,
        component: 'applications',
        action: 'db_connection_failed',
        operation: 'get_application_by_id',
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
      const applicationQuery = `
        SELECT 
          application_id,
          application_name,
          application_description,
          application_image,
          application_category,
          application_version,
          application_price,
          application_added,
          download_count,
          is_active,
          is_featured,
          updated_at
        FROM catalog.applications 
        WHERE application_id = $1
      `;

      logger.debug('Executing application fetch by ID query', {
        requestId,
        component: 'applications',
        action: 'query_start',
        operation: 'get_application_by_id',
        applicationId: cleanedApplicationId,
        table: 'catalog.applications',
      });

      result = await client.query(applicationQuery, [cleanedApplicationId]);

      logger.debug('Application fetch by ID query executed successfully', {
        requestId,
        component: 'applications',
        action: 'query_success',
        operation: 'get_application_by_id',
        applicationId: cleanedApplicationId,
        rowCount: result.rows.length,
      });
    } catch (queryError) {
      const errorCategory = categorizeError(queryError);

      logger.error('Application Fetch By ID Query Error', {
        category: errorCategory,
        message: queryError.message,
        query: 'application_fetch_by_id',
        table: 'catalog.applications',
        applicationId: cleanedApplicationId,
        requestId,
        component: 'applications',
        action: 'query_failed',
        operation: 'get_application_by_id',
      });

      // Capturer l'erreur de requête avec Sentry
      captureDatabaseError(queryError, {
        tags: {
          component: 'applications',
          action: 'query_failed',
          operation: 'SELECT',
          entity: 'application',
        },
        extra: {
          requestId,
          applicationId: cleanedApplicationId,
          table: 'catalog.applications',
          queryType: 'application_fetch_by_id',
          postgresCode: queryError.code,
          postgresDetail: queryError.detail ? '[Filtered]' : undefined,
          ip: anonymizeIp(extractRealIp(req)),
          rateLimitingApplied: true,
        },
      });

      if (client) await client.cleanup();
      return NextResponse.json(
        { error: 'Failed to fetch application from database' },
        { status: 500 },
      );
    }

    // ===== ÉTAPE 6: VÉRIFICATION EXISTENCE DE L'APPLICATION =====
    if (result.rows.length === 0) {
      logger.warn('Application not found', {
        requestId,
        component: 'applications',
        action: 'application_not_found',
        operation: 'get_application_by_id',
        applicationId: cleanedApplicationId,
      });

      // Capturer l'application non trouvée avec Sentry
      captureMessage('Application not found', {
        level: 'warning',
        tags: {
          component: 'applications',
          action: 'application_not_found',
          error_category: 'business_logic',
          entity: 'application',
          operation: 'read',
        },
        extra: {
          requestId,
          applicationId: cleanedApplicationId,
          ip: anonymizeIp(extractRealIp(req)),
        },
      });

      if (client) await client.cleanup();
      return NextResponse.json(
        { message: 'Application not found' },
        { status: 404 },
      );
    }

    // ===== ÉTAPE 7: FORMATAGE DES DONNÉES =====
    const application = result.rows[0];
    const sanitizedApplication = {
      application_id: application.application_id,
      application_name: application.application_name || '[No Name]',
      application_description: application.application_description || '',
      application_image: application.application_image,
      application_category: application.application_category || 'General',
      application_version: application.application_version || '1.0.0',
      application_price: parseFloat(application.application_price) || 0.0,
      application_added: application.application_added,
      download_count: parseInt(application.download_count) || 0,
      is_active: Boolean(application.is_active),
      is_featured: Boolean(application.is_featured),
      updated_at: application.updated_at,
    };

    logger.debug('Application data sanitized', {
      requestId,
      component: 'applications',
      action: 'data_sanitization',
      operation: 'get_application_by_id',
      applicationId: cleanedApplicationId,
    });

    // ===== ÉTAPE 8: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Application fetch by ID successful', {
      applicationId: cleanedApplicationId,
      applicationName: sanitizedApplication.application_name,
      response_time_ms: responseTime,
      database_operations: 2, // connection + query
      success: true,
      requestId,
      component: 'applications',
      action: 'fetch_by_id_success',
      entity: 'application',
      rateLimitingApplied: true,
      operation: 'get_application_by_id',
      yupValidationApplied: true,
    });

    // Capturer le succès de la récupération avec Sentry
    captureMessage('Application fetch by ID completed successfully', {
      level: 'info',
      tags: {
        component: 'applications',
        action: 'fetch_by_id_success',
        success: 'true',
        entity: 'application',
        operation: 'read',
      },
      extra: {
        requestId,
        applicationId: cleanedApplicationId,
        applicationName: sanitizedApplication.application_name,
        responseTimeMs: responseTime,
        databaseOperations: 2,
        ip: anonymizeIp(extractRealIp(req)),
        rateLimitingApplied: true,
      },
    });

    if (client) await client.cleanup();

    return NextResponse.json(
      {
        application: sanitizedApplication,
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

    logger.error('Global Get Application By ID Error', {
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
      operation: 'get_application_by_id',
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
        operation: 'read',
      },
      extra: {
        requestId,
        applicationId: id,
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'application_fetch_by_id',
        ip: anonymizeIp(extractRealIp(req)),
        rateLimitingApplied: true,
      },
    });

    if (client) await client.cleanup();

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: 'Failed to fetch application',
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
