// app/api/dashboard/applications/route.js

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
import {
  dashboardCache,
  getDashboardCacheKey,
  getCacheHeaders,
  cacheEvents,
} from '@/utils/cache';

// ----- CONFIGURATION DU RATE LIMITING POUR LES APPLICATIONS -----

// Créer le middleware de rate limiting spécifique pour les applications
const applicationsRateLimit = applyRateLimit('AUTHENTICATED_API', {
  // Configuration personnalisée pour les applications
  windowMs: 2 * 60 * 1000, // 2 minutes
  max: 60, // 60 requêtes par 2 minutes (légèrement plus généreux que templates)
  message:
    'Trop de requêtes vers les applications. Veuillez réessayer dans quelques instants.',
  skipSuccessfulRequests: false, // Compter toutes les requêtes réussies
  skipFailedRequests: false, // Compter aussi les échecs
  prefix: 'applications', // Préfixe spécifique pour les applications

  // Fonction personnalisée pour générer la clé (basée sur IP)
  keyGenerator: (req) => {
    const ip = extractRealIp(req);
    return `applications:ip:${ip}`;
  },
});

// ----- API ROUTE PRINCIPALE AVEC RATE LIMITING ET MONITORING SENTRY -----

export async function GET(req) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();

  logger.info('Applications API called', {
    timestamp: new Date().toISOString(),
    requestId,
    component: 'applications',
    action: 'api_start',
    method: 'GET',
  });

  // Capturer le début du processus de récupération des applications
  captureMessage('Applications fetch process started', {
    level: 'info',
    tags: {
      component: 'applications',
      action: 'process_start',
      api_endpoint: '/api/dashboard/applications',
      entity: 'application',
    },
    extra: {
      requestId,
      timestamp: new Date().toISOString(),
      method: 'GET',
    },
  });

  try {
    // ===== ÉTAPE 1: APPLIQUER LE RATE LIMITING =====
    logger.debug('Applying rate limiting for applications API', {
      requestId,
      component: 'applications',
      action: 'rate_limit_start',
    });

    const rateLimitResponse = await applicationsRateLimit(req);

    // Si le rate limiter retourne une réponse, cela signifie que la limite est dépassée
    if (rateLimitResponse) {
      logger.warn('Applications API rate limit exceeded', {
        requestId,
        component: 'applications',
        action: 'rate_limit_exceeded',
        ip: anonymizeIp(extractRealIp(req)),
      });

      // Capturer l'événement de rate limiting avec Sentry
      captureMessage('Applications API rate limit exceeded', {
        level: 'warning',
        tags: {
          component: 'applications',
          action: 'rate_limit_exceeded',
          error_category: 'rate_limiting',
          entity: 'application',
        },
        extra: {
          requestId,
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
    });

    // ===== ÉTAPE 2: VÉRIFICATION AUTHENTIFICATION =====
    logger.debug('Verifying user authentication', {
      requestId,
      component: 'applications',
      action: 'auth_verification_start',
    });

    await isAuthenticatedUser(req, NextResponse);

    logger.debug('User authentication verified successfully', {
      requestId,
      component: 'applications',
      action: 'auth_verification_success',
    });

    // ===== ÉTAPE 3: VÉRIFICATION DU CACHE =====
    const cacheKey = getDashboardCacheKey('applications_list', {
      endpoint: 'dashboard_applications',
      version: '1.0',
    });

    logger.debug('Checking cache for applications', {
      requestId,
      component: 'applications',
      action: 'cache_check_start',
      cacheKey,
    });

    // Vérifier si les données sont en cache
    const cachedApplications = dashboardCache.applications.get(cacheKey);

    if (cachedApplications) {
      const responseTime = Date.now() - startTime;

      logger.info('Applications served from cache', {
        applicationCount: cachedApplications.length,
        response_time_ms: responseTime,
        cache_hit: true,
        requestId,
        component: 'applications',
        action: 'cache_hit',
        entity: 'application',
        rateLimitingApplied: true,
      });

      // Capturer le succès du cache avec Sentry
      captureMessage('Applications served from cache successfully', {
        level: 'info',
        tags: {
          component: 'applications',
          action: 'cache_hit',
          success: 'true',
          entity: 'application',
        },
        extra: {
          requestId,
          applicationCount: cachedApplications.length,
          responseTimeMs: responseTime,
          cacheKey,
          ip: anonymizeIp(extractRealIp(req)),
          rateLimitingApplied: true,
        },
      });

      // Émettre un événement de cache hit
      cacheEvents.emit('dashboard_hit', {
        key: cacheKey,
        cache: dashboardCache.applications,
        entityType: 'application',
        requestId,
      });

      // Retourner les données en cache avec headers appropriés
      return NextResponse.json(
        {
          applications: cachedApplications,
          meta: {
            count: cachedApplications.length,
            requestId,
            timestamp: new Date().toISOString(),
            fromCache: true,
          },
        },
        {
          status: 200,
          headers: {
            'X-Request-ID': requestId,
            'X-Response-Time': `${responseTime}ms`,
            'X-Cache-Status': 'HIT',
            ...getCacheHeaders('applications'),
          },
        },
      );
    }

    logger.debug('Cache miss, fetching from database', {
      requestId,
      component: 'applications',
      action: 'cache_miss',
    });

    // ===== ÉTAPE 4: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
      logger.debug('Database connection successful', {
        requestId,
        component: 'applications',
        action: 'db_connection_success',
      });
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Database Connection Error during applications fetch', {
        category: errorCategory,
        message: dbConnectionError.message,
        timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
        requestId,
        component: 'applications',
        action: 'db_connection_failed',
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
      const applicationsQuery = `
        SELECT 
          application_id, 
          application_name, 
          application_images, 
          application_fee, 
          application_rent, 
          application_link, 
          application_level,
          is_active,
          created_at,
          sales_count,
          updated_at
        FROM catalog.applications
        ORDER BY created_at DESC
      `;

      logger.debug('Executing applications query', {
        requestId,
        component: 'applications',
        action: 'query_start',
        table: 'catalog.applications',
        operation: 'SELECT',
      });

      result = await client.query(applicationsQuery);

      logger.debug('Applications query executed successfully', {
        requestId,
        component: 'applications',
        action: 'query_success',
        rowCount: result.rows.length,
        table: 'catalog.applications',
      });
    } catch (queryError) {
      const errorCategory = categorizeError(queryError);

      logger.error('Applications Query Error', {
        category: errorCategory,
        message: queryError.message,
        query: 'applications_fetch',
        table: 'catalog.applications',
        requestId,
        component: 'applications',
        action: 'query_failed',
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
          table: 'catalog.applications',
          queryType: 'applications_fetch',
          postgresCode: queryError.code,
          postgresDetail: queryError.detail ? '[Filtered]' : undefined,
          ip: anonymizeIp(extractRealIp(req)),
          rateLimitingApplied: true,
        },
      });

      if (client) await client.cleanup();
      return NextResponse.json(
        { error: 'Failed to fetch applications from database' },
        { status: 500 },
      );
    }

    // ===== ÉTAPE 6: VALIDATION DES DONNÉES =====
    if (!result || !Array.isArray(result.rows)) {
      logger.warn('Applications query returned invalid data structure', {
        requestId,
        component: 'applications',
        action: 'invalid_data_structure',
        resultType: typeof result,
        hasRows: !!result?.rows,
        isArray: Array.isArray(result?.rows),
      });

      captureMessage('Applications query returned invalid data structure', {
        level: 'warning',
        tags: {
          component: 'applications',
          action: 'invalid_data_structure',
          error_category: 'business_logic',
          entity: 'application',
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

    // ===== ÉTAPE 7: NETTOYAGE ET FORMATAGE DES DONNÉES =====
    const sanitizedApplications = result.rows.map((application) => ({
      application_id: application.application_id,
      application_name: application.application_name || '[No Name]',
      application_images: application.application_images,
      application_fee: parseFloat(application.application_fee) || 0,
      application_rent: parseFloat(application.application_rent) || 0,
      application_link: application.application_link,
      application_level: application.application_level || '1',
      application_added: application.created_at,
      is_active: Boolean(application.is_active),
      sales_count: parseInt(application.sales_count) || 0,
      updated_at: application.updated_at,
    }));

    logger.debug('Applications data sanitized', {
      requestId,
      component: 'applications',
      action: 'data_sanitization',
      originalCount: result.rows.length,
      sanitizedCount: sanitizedApplications.length,
    });

    // ===== ÉTAPE 8: MISE EN CACHE DES DONNÉES =====
    logger.debug('Caching applications data', {
      requestId,
      component: 'applications',
      action: 'cache_set_start',
      applicationCount: sanitizedApplications.length,
    });

    // Mettre les données en cache
    const cacheSuccess = dashboardCache.applications.set(
      cacheKey,
      sanitizedApplications,
    );

    if (cacheSuccess) {
      logger.debug('Applications data cached successfully', {
        requestId,
        component: 'applications',
        action: 'cache_set_success',
        cacheKey,
      });

      // Émettre un événement de cache set
      cacheEvents.emit('dashboard_set', {
        key: cacheKey,
        cache: dashboardCache.applications,
        entityType: 'application',
        requestId,
        size: sanitizedApplications.length,
      });
    } else {
      logger.warn('Failed to cache applications data', {
        requestId,
        component: 'applications',
        action: 'cache_set_failed',
        cacheKey,
      });
    }

    // ===== ÉTAPE 9: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Applications fetch successful', {
      applicationCount: sanitizedApplications.length,
      response_time_ms: responseTime,
      database_operations: 2, // connection + query
      success: true,
      requestId,
      component: 'applications',
      action: 'fetch_success',
      entity: 'application',
      rateLimitingApplied: true,
      cacheMiss: true,
      cacheSet: cacheSuccess,
    });

    // Capturer le succès de la récupération avec Sentry
    captureMessage('Applications fetch completed successfully', {
      level: 'info',
      tags: {
        component: 'applications',
        action: 'fetch_success',
        success: 'true',
        entity: 'application',
      },
      extra: {
        requestId,
        applicationCount: sanitizedApplications.length,
        responseTimeMs: responseTime,
        databaseOperations: 2,
        ip: anonymizeIp(extractRealIp(req)),
        rateLimitingApplied: true,
        cacheMiss: true,
        cacheSet: cacheSuccess,
      },
    });

    if (client) await client.cleanup();

    return NextResponse.json(
      {
        applications: sanitizedApplications,
        meta: {
          count: sanitizedApplications.length,
          requestId,
          timestamp: new Date().toISOString(),
        },
      },
      {
        status: 200,
        headers: {
          'X-Request-ID': requestId,
          'X-Response-Time': `${responseTime}ms`,
          'X-Cache-Status': 'MISS',
          ...getCacheHeaders('applications'),
        },
      },
    );
  } catch (error) {
    // ===== GESTION GLOBALE DES ERREURS =====
    const errorCategory = categorizeError(error);
    const responseTime = Date.now() - startTime;

    logger.error('Global Applications Error', {
      category: errorCategory,
      response_time_ms: responseTime,
      reached_global_handler: true,
      error_name: error.name,
      error_message: error.message,
      stack_available: !!error.stack,
      requestId,
      component: 'applications',
      action: 'global_error_handler',
      entity: 'application',
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
      },
      extra: {
        requestId,
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'applications_fetch',
        ip: anonymizeIp(extractRealIp(req)),
        rateLimitingApplied: true,
      },
    });

    if (client) await client.cleanup();

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: 'Failed to fetch applications',
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
