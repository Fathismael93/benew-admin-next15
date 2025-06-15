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

export async function GET(req) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();

  logger.info('Templates API called', {
    timestamp: new Date().toISOString(),
    requestId,
    component: 'templates',
    action: 'api_start',
    method: 'GET',
  });

  // Capturer le début du processus de récupération des templates
  captureMessage('Templates fetch process started', {
    level: 'info',
    tags: {
      component: 'templates',
      action: 'process_start',
      api_endpoint: '/api/dashboard/templates',
      entity: 'template',
    },
    extra: {
      requestId,
      timestamp: new Date().toISOString(),
      method: 'GET',
    },
  });

  try {
    // 1. Vérifier l'authentification
    await isAuthenticatedUser(req, NextResponse);

    // ===== ÉTAPE 1: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
      logger.debug('Database connection successful', {
        requestId,
        component: 'templates',
        action: 'db_connection_success',
      });
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Database Connection Error during templates fetch', {
        category: errorCategory,
        message: dbConnectionError.message,
        timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
        requestId,
        component: 'templates',
        action: 'db_connection_failed',
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
          ip: anonymizeIp(extractRealIp(req)),
        },
      });

      return NextResponse.json(
        { error: 'Database connection failed' },
        { status: 503 },
      );
    }

    // ===== ÉTAPE 2: EXÉCUTION DE LA REQUÊTE =====
    let result;
    try {
      const templatesQuery = `
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
        ORDER BY template_added DESC
      `;

      logger.debug('Executing templates query', {
        requestId,
        component: 'templates',
        action: 'query_start',
        table: 'catalog.templates',
        operation: 'SELECT',
      });

      result = await client.query(templatesQuery);

      logger.debug('Templates query executed successfully', {
        requestId,
        component: 'templates',
        action: 'query_success',
        rowCount: result.rows.length,
        table: 'catalog.templates',
      });
    } catch (queryError) {
      const errorCategory = categorizeError(queryError);

      logger.error('Templates Query Error', {
        category: errorCategory,
        message: queryError.message,
        query: 'templates_fetch',
        table: 'catalog.templates',
        requestId,
        component: 'templates',
        action: 'query_failed',
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
          table: 'catalog.templates',
          queryType: 'templates_fetch',
          postgresCode: queryError.code,
          postgresDetail: queryError.detail ? '[Filtered]' : undefined,
          ip: anonymizeIp(extractRealIp(req)),
        },
      });

      if (client) await client.cleanup();
      return NextResponse.json(
        { error: 'Failed to fetch templates from database' },
        { status: 500 },
      );
    }

    // ===== ÉTAPE 3: VALIDATION DES DONNÉES =====
    if (!result || !Array.isArray(result.rows)) {
      logger.warn('Templates query returned invalid data structure', {
        requestId,
        component: 'templates',
        action: 'invalid_data_structure',
        resultType: typeof result,
        hasRows: !!result?.rows,
        isArray: Array.isArray(result?.rows),
      });

      captureMessage('Templates query returned invalid data structure', {
        level: 'warning',
        tags: {
          component: 'templates',
          action: 'invalid_data_structure',
          error_category: 'business_logic',
          entity: 'template',
        },
        extra: {
          requestId,
          resultType: typeof result,
          hasRows: !!result?.rows,
          isArray: Array.isArray(result?.rows),
        },
      });

      if (client) await client.cleanup();
      return NextResponse.json(
        { error: 'Invalid data structure returned from database' },
        { status: 500 },
      );
    }

    // ===== ÉTAPE 4: NETTOYAGE ET FORMATAGE DES DONNÉES =====
    const sanitizedTemplates = result.rows.map((template) => ({
      template_id: template.template_id,
      template_name: template.template_name || '[No Name]',
      template_image: template.template_image,
      template_has_web: Boolean(template.template_has_web),
      template_has_mobile: Boolean(template.template_has_mobile),
      template_added: template.template_added,
      sales_count: parseInt(template.sales_count) || 0,
      is_active: Boolean(template.is_active),
      updated_at: template.updated_at,
    }));

    logger.debug('Templates data sanitized', {
      requestId,
      component: 'templates',
      action: 'data_sanitization',
      originalCount: result.rows.length,
      sanitizedCount: sanitizedTemplates.length,
    });

    // ===== ÉTAPE 5: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Templates fetch successful', {
      templateCount: sanitizedTemplates.length,
      response_time_ms: responseTime,
      database_operations: 2, // connection + query
      success: true,
      requestId,
      component: 'templates',
      action: 'fetch_success',
      entity: 'template',
    });

    // Capturer le succès de la récupération avec Sentry
    captureMessage('Templates fetch completed successfully', {
      level: 'info',
      tags: {
        component: 'templates',
        action: 'fetch_success',
        success: 'true',
        entity: 'template',
      },
      extra: {
        requestId,
        templateCount: sanitizedTemplates.length,
        responseTimeMs: responseTime,
        databaseOperations: 2,
        ip: anonymizeIp(extractRealIp(req)),
      },
    });

    if (client) await client.cleanup();

    return NextResponse.json(
      {
        templates: sanitizedTemplates,
        meta: {
          count: sanitizedTemplates.length,
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

    logger.error('Global Templates Error', {
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
      },
      extra: {
        requestId,
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'templates_fetch',
        ip: anonymizeIp(extractRealIp(req)),
      },
    });

    if (client) await client.cleanup();

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: 'Failed to fetch templates',
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
