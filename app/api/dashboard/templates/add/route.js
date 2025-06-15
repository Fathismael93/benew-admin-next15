// app/api/dashboard/templates/add/route.js
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

// ----- CONFIGURATION DU RATE LIMITING POUR L'AJOUT DE TEMPLATES -----

// Créer le middleware de rate limiting spécifique pour l'ajout de templates
const addTemplateRateLimit = applyRateLimit('CONTENT_API', {
  // Configuration personnalisée pour l'ajout de templates
  windowMs: 5 * 60 * 1000, // 5 minutes (plus strict pour les mutations)
  max: 10, // 10 ajouts par 5 minutes (plus restrictif car création)
  message:
    "Trop de tentatives d'ajout de templates. Veuillez réessayer dans quelques minutes.",
  skipSuccessfulRequests: false, // Compter tous les ajouts réussis
  skipFailedRequests: false, // Compter aussi les échecs
  prefix: 'add_template', // Préfixe spécifique pour l'ajout de templates

  // Fonction personnalisée pour générer la clé (basée sur IP)
  keyGenerator: (req) => {
    const ip = extractRealIp(req);
    return `add_template:ip:${ip}`;
  },
});

// ----- API ROUTE PRINCIPALE AVEC RATE LIMITING -----

export async function POST(request) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();

  logger.info('Add Template API called', {
    timestamp: new Date().toISOString(),
    requestId,
    component: 'templates',
    action: 'api_start',
    method: 'POST',
    operation: 'add_template',
  });

  // Capturer le début du processus d'ajout de template
  captureMessage('Add template process started', {
    level: 'info',
    tags: {
      component: 'templates',
      action: 'process_start',
      api_endpoint: '/api/dashboard/templates/add',
      entity: 'template',
      operation: 'create',
    },
    extra: {
      requestId,
      timestamp: new Date().toISOString(),
      method: 'POST',
    },
  });

  try {
    // ===== ÉTAPE 1: APPLIQUER LE RATE LIMITING =====
    logger.debug('Applying rate limiting for add template API', {
      requestId,
      component: 'templates',
      action: 'rate_limit_start',
      operation: 'add_template',
    });

    const rateLimitResponse = await addTemplateRateLimit(request);

    // Si le rate limiter retourne une réponse, cela signifie que la limite est dépassée
    if (rateLimitResponse) {
      logger.warn('Add template API rate limit exceeded', {
        requestId,
        component: 'templates',
        action: 'rate_limit_exceeded',
        operation: 'add_template',
        ip: anonymizeIp(extractRealIp(request)),
      });

      // Capturer l'événement de rate limiting avec Sentry
      captureMessage('Add template API rate limit exceeded', {
        level: 'warning',
        tags: {
          component: 'templates',
          action: 'rate_limit_exceeded',
          error_category: 'rate_limiting',
          entity: 'template',
          operation: 'create',
        },
        extra: {
          requestId,
          ip: anonymizeIp(extractRealIp(request)),
          userAgent:
            request.headers.get('user-agent')?.substring(0, 100) || 'unknown',
        },
      });

      return rateLimitResponse; // Retourner directement la réponse 429
    }

    logger.debug('Rate limiting passed successfully', {
      requestId,
      component: 'templates',
      action: 'rate_limit_passed',
      operation: 'add_template',
    });

    // ===== ÉTAPE 2: VÉRIFICATION AUTHENTIFICATION =====
    logger.debug('Verifying user authentication', {
      requestId,
      component: 'templates',
      action: 'auth_verification_start',
      operation: 'add_template',
    });

    await isAuthenticatedUser(request, NextResponse);

    logger.debug('User authentication verified successfully', {
      requestId,
      component: 'templates',
      action: 'auth_verification_success',
      operation: 'add_template',
    });

    // ===== ÉTAPE 3: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
      logger.debug('Database connection successful', {
        requestId,
        component: 'templates',
        action: 'db_connection_success',
        operation: 'add_template',
      });
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Database Connection Error during template addition', {
        category: errorCategory,
        message: dbConnectionError.message,
        timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
        requestId,
        component: 'templates',
        action: 'db_connection_failed',
        operation: 'add_template',
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

    // ===== ÉTAPE 4: PARSING ET VALIDATION DU BODY =====
    let body;
    try {
      body = await request.json();
      logger.debug('Request body parsed successfully', {
        requestId,
        component: 'templates',
        action: 'body_parse_success',
        operation: 'add_template',
      });
    } catch (parseError) {
      const errorCategory = categorizeError(parseError);

      logger.error('JSON Parse Error during template addition', {
        category: errorCategory,
        message: parseError.message,
        requestId,
        component: 'templates',
        action: 'json_parse_error',
        operation: 'add_template',
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
          operation: 'create',
        },
        extra: {
          requestId,
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

    const { templateName, templateImageId, templateHasWeb, templateHasMobile } =
      body;

    logger.debug('Template data extracted from request', {
      requestId,
      component: 'templates',
      action: 'data_extraction',
      operation: 'add_template',
      hasTemplateName: !!templateName,
      hasTemplateImageId: !!templateImageId,
    });

    // ===== ÉTAPE 5: VALIDATION DES CHAMPS REQUIS =====
    if (!templateName || !templateImageId) {
      logger.warn('Template validation failed - missing required fields', {
        requestId,
        component: 'templates',
        action: 'validation_failed',
        operation: 'add_template',
        missingFields: {
          templateName: !templateName,
          templateImageId: !templateImageId,
        },
      });

      // Capturer l'erreur de validation avec Sentry
      captureMessage('Template validation failed - missing required fields', {
        level: 'warning',
        tags: {
          component: 'templates',
          action: 'validation_failed',
          error_category: 'validation',
          entity: 'template',
          operation: 'create',
        },
        extra: {
          requestId,
          missingFields: {
            templateName: !templateName,
            templateImageId: !templateImageId,
          },
        },
      });

      if (client) await client.cleanup();
      return NextResponse.json(
        { message: 'Template name and image are required' },
        { status: 400 },
      );
    }

    logger.debug('Template validation passed', {
      requestId,
      component: 'templates',
      action: 'validation_success',
      operation: 'add_template',
    });

    // ===== ÉTAPE 6: INSERTION EN BASE DE DONNÉES =====
    let result;
    try {
      const queryText = `
        INSERT INTO catalog.templates (
          template_name,
          template_image,
          template_has_web,
          template_has_mobile
        ) VALUES ($1, $2, $3, $4)
        RETURNING template_id
      `;

      const values = [
        templateName,
        templateImageId || null,
        templateHasWeb === undefined ? true : templateHasWeb,
        templateHasMobile === undefined ? false : templateHasMobile,
      ];

      logger.debug('Executing template insertion query', {
        requestId,
        component: 'templates',
        action: 'query_start',
        operation: 'add_template',
        table: 'catalog.templates',
      });

      result = await client.query(queryText, values);

      logger.debug('Template insertion query executed successfully', {
        requestId,
        component: 'templates',
        action: 'query_success',
        operation: 'add_template',
        newTemplateId: result.rows[0]?.template_id,
      });
    } catch (insertError) {
      const errorCategory = categorizeError(insertError);

      logger.error('Template Insertion Error', {
        category: errorCategory,
        message: insertError.message,
        operation: 'INSERT INTO templates',
        table: 'catalog.templates',
        requestId,
        component: 'templates',
        action: 'query_failed',
      });

      // Capturer l'erreur d'insertion avec Sentry
      captureDatabaseError(insertError, {
        tags: {
          component: 'templates',
          action: 'insertion_failed',
          operation: 'INSERT',
          entity: 'template',
        },
        extra: {
          requestId,
          table: 'catalog.templates',
          queryType: 'template_insertion',
          postgresCode: insertError.code,
          postgresDetail: insertError.detail ? '[Filtered]' : undefined,
          ip: anonymizeIp(extractRealIp(request)),
          rateLimitingApplied: true,
        },
      });

      if (client) await client.cleanup();
      return NextResponse.json(
        { error: 'Failed to add template to database' },
        { status: 500 },
      );
    }

    // ===== ÉTAPE 7: SUCCÈS - LOG ET NETTOYAGE =====
    const newTemplateId = result.rows[0].template_id;
    const responseTime = Date.now() - startTime;

    logger.info('Template addition successful', {
      newTemplateId,
      templateName,
      response_time_ms: responseTime,
      database_operations: 2, // connection + insert
      success: true,
      requestId,
      component: 'templates',
      action: 'addition_success',
      entity: 'template',
      rateLimitingApplied: true,
      operation: 'add_template',
    });

    // Capturer le succès de l'ajout avec Sentry
    captureMessage('Template addition completed successfully', {
      level: 'info',
      tags: {
        component: 'templates',
        action: 'addition_success',
        success: 'true',
        entity: 'template',
        operation: 'create',
      },
      extra: {
        requestId,
        newTemplateId,
        templateName,
        responseTimeMs: responseTime,
        databaseOperations: 2,
        ip: anonymizeIp(extractRealIp(request)),
        rateLimitingApplied: true,
      },
    });

    if (client) await client.cleanup();

    return NextResponse.json(
      {
        message: 'Template added successfully',
        templateId: newTemplateId,
        meta: {
          requestId,
          timestamp: new Date().toISOString(),
        },
      },
      {
        status: 201,
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

    logger.error('Global Add Template Error', {
      category: errorCategory,
      response_time_ms: responseTime,
      reached_global_handler: true,
      error_name: error.name,
      error_message: error.message,
      stack_available: !!error.stack,
      requestId,
      component: 'templates',
      action: 'global_error_handler',
      entity: 'template',
      operation: 'add_template',
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
        operation: 'create',
      },
      extra: {
        requestId,
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'template_addition',
        ip: anonymizeIp(extractRealIp(request)),
        rateLimitingApplied: true,
      },
    });

    if (client) await client.cleanup();

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: 'Failed to add template',
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
