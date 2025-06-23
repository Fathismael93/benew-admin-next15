// app/api/dashboard/platforms/route.js

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

// ----- CONFIGURATION DU RATE LIMITING POUR LES PLATEFORMES -----

// Créer le middleware de rate limiting spécifique pour les plateformes
const platformsRateLimit = applyRateLimit('AUTHENTICATED_API', {
  // Configuration personnalisée pour les plateformes (plus restrictif car données sensibles)
  windowMs: 3 * 60 * 1000, // 3 minutes (plus restrictif que templates)
  max: 30, // 30 requêtes par 3 minutes (moins que templates car données bancaires)
  message:
    'Trop de requêtes vers les plateformes de paiement. Veuillez réessayer dans quelques instants.',
  skipSuccessfulRequests: false, // Compter toutes les requêtes réussies
  skipFailedRequests: false, // Compter aussi les échecs
  prefix: 'platforms', // Préfixe spécifique pour les plateformes

  // Fonction personnalisée pour générer la clé (basée sur IP)
  keyGenerator: (req) => {
    const ip = extractRealIp(req);
    return `platforms:ip:${ip}`;
  },
});

// ----- API ROUTE PRINCIPALE AVEC RATE LIMITING ET MONITORING SENTRY -----

export async function GET(req) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();

  logger.info('Platforms API called', {
    timestamp: new Date().toISOString(),
    requestId,
    component: 'platforms',
    action: 'api_start',
    method: 'GET',
  });

  // Capturer le début du processus de récupération des plateformes
  captureMessage('Platforms fetch process started', {
    level: 'info',
    tags: {
      component: 'platforms',
      action: 'process_start',
      api_endpoint: '/api/dashboard/platforms',
      entity: 'platform',
    },
    extra: {
      requestId,
      timestamp: new Date().toISOString(),
      method: 'GET',
    },
  });

  try {
    // ===== ÉTAPE 1: APPLIQUER LE RATE LIMITING =====
    logger.debug('Applying rate limiting for platforms API', {
      requestId,
      component: 'platforms',
      action: 'rate_limit_start',
    });

    const rateLimitResponse = await platformsRateLimit(req);

    // Si le rate limiter retourne une réponse, cela signifie que la limite est dépassée
    if (rateLimitResponse) {
      logger.warn('Platforms API rate limit exceeded', {
        requestId,
        component: 'platforms',
        action: 'rate_limit_exceeded',
        ip: anonymizeIp(extractRealIp(req)),
      });

      // Capturer l'événement de rate limiting avec Sentry
      captureMessage('Platforms API rate limit exceeded', {
        level: 'warning',
        tags: {
          component: 'platforms',
          action: 'rate_limit_exceeded',
          error_category: 'rate_limiting',
          entity: 'platform',
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
      component: 'platforms',
      action: 'rate_limit_passed',
    });

    // ===== ÉTAPE 2: VÉRIFICATION AUTHENTIFICATION =====
    logger.debug('Verifying user authentication', {
      requestId,
      component: 'platforms',
      action: 'auth_verification_start',
    });

    await isAuthenticatedUser(req, NextResponse);

    logger.debug('User authentication verified successfully', {
      requestId,
      component: 'platforms',
      action: 'auth_verification_success',
    });

    // ===== ÉTAPE 3: VÉRIFICATION DU CACHE =====
    const cacheKey = getDashboardCacheKey('platforms_list', {
      endpoint: 'dashboard_platforms',
      version: '1.0',
    });

    logger.debug('Checking cache for platforms', {
      requestId,
      component: 'platforms',
      action: 'cache_check_start',
      cacheKey,
    });

    // Vérifier si les données sont en cache
    const cachedPlatforms = dashboardCache.platforms.get(cacheKey);

    if (cachedPlatforms) {
      const responseTime = Date.now() - startTime;

      logger.info('Platforms served from cache', {
        platformCount: cachedPlatforms.length,
        response_time_ms: responseTime,
        cache_hit: true,
        requestId,
        component: 'platforms',
        action: 'cache_hit',
        entity: 'platform',
        rateLimitingApplied: true,
      });

      // Capturer le succès du cache avec Sentry
      captureMessage('Platforms served from cache successfully', {
        level: 'info',
        tags: {
          component: 'platforms',
          action: 'cache_hit',
          success: 'true',
          entity: 'platform',
        },
        extra: {
          requestId,
          platformCount: cachedPlatforms.length,
          responseTimeMs: responseTime,
          cacheKey,
          ip: anonymizeIp(extractRealIp(req)),
          rateLimitingApplied: true,
        },
      });

      // Émettre un événement de cache hit
      cacheEvents.emit('dashboard_hit', {
        key: cacheKey,
        cache: dashboardCache.platforms,
        entityType: 'platform',
        requestId,
      });

      // Retourner les données en cache avec headers appropriés
      return NextResponse.json(
        {
          platforms: cachedPlatforms,
          meta: {
            count: cachedPlatforms.length,
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
            ...getCacheHeaders('platforms'),
          },
        },
      );
    }

    logger.debug('Cache miss, fetching from database', {
      requestId,
      component: 'platforms',
      action: 'cache_miss',
    });

    // ===== ÉTAPE 4: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
      logger.debug('Database connection successful', {
        requestId,
        component: 'platforms',
        action: 'db_connection_success',
      });
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Database Connection Error during platforms fetch', {
        category: errorCategory,
        message: dbConnectionError.message,
        timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
        requestId,
        component: 'platforms',
        action: 'db_connection_failed',
      });

      // Capturer l'erreur de connexion DB avec Sentry
      captureDatabaseError(dbConnectionError, {
        tags: {
          component: 'platforms',
          action: 'db_connection_failed',
          operation: 'connection',
          entity: 'platform',
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
      const platformsQuery = `
        SELECT 
          platform_id, 
          platform_name, 
          platform_number, 
          created_at, 
          updated_at, 
          is_active
        FROM admin.platforms 
        ORDER BY created_at DESC
      `;

      logger.debug('Executing platforms query', {
        requestId,
        component: 'platforms',
        action: 'query_start',
        table: 'admin.platforms',
        operation: 'SELECT',
      });

      result = await client.query(platformsQuery);

      logger.debug('Platforms query executed successfully', {
        requestId,
        component: 'platforms',
        action: 'query_success',
        rowCount: result.rows.length,
        table: 'admin.platforms',
      });
    } catch (queryError) {
      const errorCategory = categorizeError(queryError);

      logger.error('Platforms Query Error', {
        category: errorCategory,
        message: queryError.message,
        query: 'platforms_fetch',
        table: 'admin.platforms',
        requestId,
        component: 'platforms',
        action: 'query_failed',
      });

      // Capturer l'erreur de requête avec Sentry
      captureDatabaseError(queryError, {
        tags: {
          component: 'platforms',
          action: 'query_failed',
          operation: 'SELECT',
          entity: 'platform',
        },
        extra: {
          requestId,
          table: 'admin.platforms',
          queryType: 'platforms_fetch',
          postgresCode: queryError.code,
          postgresDetail: queryError.detail ? '[Filtered]' : undefined,
          ip: anonymizeIp(extractRealIp(req)),
          rateLimitingApplied: true,
        },
      });

      if (client) await client.cleanup();
      return NextResponse.json(
        { error: 'Failed to fetch platforms from database' },
        { status: 500 },
      );
    }

    // ===== ÉTAPE 6: VALIDATION DES DONNÉES =====
    if (!result || !Array.isArray(result.rows)) {
      logger.warn('Platforms query returned invalid data structure', {
        requestId,
        component: 'platforms',
        action: 'invalid_data_structure',
        resultType: typeof result,
        hasRows: !!result?.rows,
        isArray: Array.isArray(result?.rows),
      });

      captureMessage('Platforms query returned invalid data structure', {
        level: 'warning',
        tags: {
          component: 'platforms',
          action: 'invalid_data_structure',
          error_category: 'business_logic',
          entity: 'platform',
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
    const sanitizedPlatforms = result.rows.map((platform) => ({
      platform_id: platform.platform_id,
      platform_name: platform.platform_name || '[No Name]',
      // Masquer partiellement le numéro pour la sécurité (données bancaires sensibles)
      platform_number: platform.platform_number
        ? `${platform.platform_number.slice(0, 3)}***${platform.platform_number.slice(-2)}`
        : '[No Number]',
      platform_number_full: platform.platform_number, // Version complète pour usage interne
      created_at: platform.created_at,
      updated_at: platform.updated_at,
      is_active: Boolean(platform.is_active),
    }));

    logger.debug('Platforms data sanitized', {
      requestId,
      component: 'platforms',
      action: 'data_sanitization',
      originalCount: result.rows.length,
      sanitizedCount: sanitizedPlatforms.length,
    });

    // ===== ÉTAPE 8: MISE EN CACHE DES DONNÉES =====
    logger.debug('Caching platforms data', {
      requestId,
      component: 'platforms',
      action: 'cache_set_start',
      platformCount: sanitizedPlatforms.length,
    });

    // Mettre les données en cache (sans les numéros complets pour sécurité)
    const cacheData = sanitizedPlatforms.map((platform) => {
      const { platform_number_full, ...platformForCache } = platform;
      return platformForCache;
    });

    const cacheSuccess = dashboardCache.platforms.set(cacheKey, cacheData);

    if (cacheSuccess) {
      logger.debug('Platforms data cached successfully', {
        requestId,
        component: 'platforms',
        action: 'cache_set_success',
        cacheKey,
      });

      // Émettre un événement de cache set
      cacheEvents.emit('dashboard_set', {
        key: cacheKey,
        cache: dashboardCache.platforms,
        entityType: 'platform',
        requestId,
        size: cacheData.length,
      });
    } else {
      logger.warn('Failed to cache platforms data', {
        requestId,
        component: 'platforms',
        action: 'cache_set_failed',
        cacheKey,
      });
    }

    // ===== ÉTAPE 9: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Platforms fetch successful', {
      platformCount: sanitizedPlatforms.length,
      response_time_ms: responseTime,
      database_operations: 2, // connection + query
      success: true,
      requestId,
      component: 'platforms',
      action: 'fetch_success',
      entity: 'platform',
      rateLimitingApplied: true,
      cacheMiss: true,
      cacheSet: cacheSuccess,
      dataSanitized: true,
    });

    // Capturer le succès de la récupération avec Sentry
    captureMessage('Platforms fetch completed successfully', {
      level: 'info',
      tags: {
        component: 'platforms',
        action: 'fetch_success',
        success: 'true',
        entity: 'platform',
      },
      extra: {
        requestId,
        platformCount: sanitizedPlatforms.length,
        responseTimeMs: responseTime,
        databaseOperations: 2,
        ip: anonymizeIp(extractRealIp(req)),
        rateLimitingApplied: true,
        cacheMiss: true,
        cacheSet: cacheSuccess,
        dataSanitized: true,
      },
    });

    if (client) await client.cleanup();

    // Retourner les données sans les numéros complets (sécurité)
    return NextResponse.json(
      {
        platforms: cacheData,
        meta: {
          count: cacheData.length,
          requestId,
          timestamp: new Date().toISOString(),
          security_note: 'Platform numbers are partially masked for security',
        },
      },
      {
        status: 200,
        headers: {
          'X-Request-ID': requestId,
          'X-Response-Time': `${responseTime}ms`,
          'X-Cache-Status': 'MISS',
          ...getCacheHeaders('platforms'),
        },
      },
    );
  } catch (error) {
    // ===== GESTION GLOBALE DES ERREURS =====
    const errorCategory = categorizeError(error);
    const responseTime = Date.now() - startTime;

    logger.error('Global Platforms Error', {
      category: errorCategory,
      response_time_ms: responseTime,
      reached_global_handler: true,
      error_name: error.name,
      error_message: error.message,
      stack_available: !!error.stack,
      requestId,
      component: 'platforms',
      action: 'global_error_handler',
      entity: 'platform',
    });

    // Capturer l'erreur globale avec Sentry
    captureException(error, {
      level: 'error',
      tags: {
        component: 'platforms',
        action: 'global_error_handler',
        error_category: errorCategory,
        critical: 'true',
        entity: 'platform',
      },
      extra: {
        requestId,
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'platforms_fetch',
        ip: anonymizeIp(extractRealIp(req)),
        rateLimitingApplied: true,
      },
    });

    if (client) await client.cleanup();

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: 'Failed to fetch platforms',
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
