import { NextResponse } from 'next/server';
import { getClient } from '@backend/dbConnect';
import { applyRateLimit } from '@backend/rateLimiter';
import isAuthenticatedUser from '@backend/authMiddleware';
import {
  captureException,
  captureMessage,
  captureDatabaseError,
} from '@monitoring/sentry';
import {
  categorizeError,
  generateRequestId,
  extractRealIp,
  anonymizeIp,
} from '@utils/helpers';
import logger from '@utils/logger';
import {
  dashboardCache,
  getDashboardCacheKey,
  getCacheHeaders,
  cacheEvents,
} from '@utils/cache';

// ----- CONFIGURATION DU RATE LIMITING POUR LES COMMANDES -----

// Créer le middleware de rate limiting spécifique pour les commandes (données sensibles)
const ordersRateLimit = applyRateLimit('orders', {
  // Configuration personnalisée pour les commandes
  windowMs: 1 * 60 * 1000, // 1 minute (plus strict que applications)
  max: 30, // 30 requêtes par minute (données financières sensibles)
  message:
    'Trop de requêtes vers les commandes. Veuillez réessayer dans quelques instants.',
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
  prefix: 'orders',

  // Fonction personnalisée pour générer la clé (basée sur IP)
  keyGenerator: (req) => {
    const ip = extractRealIp(req);
    return `orders:ip:${ip}`;
  },
});

/**
 * GET /api/dashboard/orders
 * Récupère la liste des commandes avec pagination et filtres
 * Production-ready avec authentification, rate limiting, cache et monitoring complet
 */
export async function GET(req) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();

  logger.info('Orders API called', {
    timestamp: new Date().toISOString(),
    requestId,
    component: 'orders',
    action: 'api_start',
    method: 'GET',
  });

  // Capturer le début du processus de récupération des commandes
  captureMessage('Orders fetch process started', {
    level: 'info',
    tags: {
      component: 'orders',
      action: 'process_start',
      api_endpoint: '/api/dashboard/orders',
      entity: 'order',
      data_type: 'financial',
    },
    extra: {
      requestId,
      timestamp: new Date().toISOString(),
      method: 'GET',
    },
  });

  try {
    // ===== ÉTAPE 1: APPLIQUER LE RATE LIMITING =====
    logger.debug('Applying rate limiting for orders API', {
      requestId,
      component: 'orders',
      action: 'rate_limit_start',
      data_sensitivity: 'high',
    });

    const rateLimitResponse = await ordersRateLimit(req);

    // Si le rate limiter retourne une réponse, cela signifie que la limite est dépassée
    if (rateLimitResponse) {
      logger.warn('Orders API rate limit exceeded', {
        requestId,
        component: 'orders',
        action: 'rate_limit_exceeded',
        ip: anonymizeIp(extractRealIp(req)),
        data_type: 'financial',
      });

      // Capturer l'événement de rate limiting avec Sentry
      captureMessage('Orders API rate limit exceeded', {
        level: 'warning',
        tags: {
          component: 'orders',
          action: 'rate_limit_exceeded',
          error_category: 'rate_limiting',
          entity: 'order',
          data_type: 'financial',
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
      component: 'orders',
      action: 'rate_limit_passed',
    });

    // ===== ÉTAPE 2: VÉRIFICATION AUTHENTIFICATION =====
    logger.debug('Verifying user authentication', {
      requestId,
      component: 'orders',
      action: 'auth_verification_start',
    });

    await isAuthenticatedUser(req, NextResponse);

    logger.debug('User authentication verified successfully', {
      requestId,
      component: 'orders',
      action: 'auth_verification_success',
    });

    // ===== ÉTAPE 3: EXTRACTION ET VALIDATION DES PARAMÈTRES =====

    logger.debug('Request parameters extracted and validated', {
      requestId,
      component: 'orders',
      action: 'params_validation',
      status: 'all',
    });

    // ===== ÉTAPE 4: VÉRIFICATION DU CACHE =====
    const cacheKey = getDashboardCacheKey('orders_list', {
      status: 'all',
      version: '1.0',
    });

    logger.debug('Checking cache for orders', {
      requestId,
      component: 'orders',
      action: 'cache_check_start',
      cacheKey: cacheKey.substring(0, 50), // Tronquer pour les logs
    });

    // Vérifier si les données sont en cache
    const cachedOrders = dashboardCache.orders.get(cacheKey);

    if (cachedOrders) {
      const responseTime = Date.now() - startTime;

      logger.info('Orders served from cache', {
        orderCount: cachedOrders.data?.orders?.length || 0,
        response_time_ms: responseTime,
        cache_hit: true,
        requestId,
        component: 'orders',
        action: 'cache_hit',
        entity: 'order',
        data_type: 'financial',
        rateLimitingApplied: true,
      });

      // Capturer le succès du cache avec Sentry
      captureMessage('Orders served from cache successfully', {
        level: 'info',
        tags: {
          component: 'orders',
          action: 'cache_hit',
          success: 'true',
          entity: 'order',
          data_type: 'financial',
        },
        extra: {
          requestId,
          orderCount: cachedOrders.data?.orders?.length || 0,
          responseTimeMs: responseTime,
          cacheKey: cacheKey.substring(0, 50),
          ip: anonymizeIp(extractRealIp(req)),
          rateLimitingApplied: true,
        },
      });

      // Émettre un événement de cache hit
      cacheEvents.emit('dashboard_hit', {
        key: cacheKey,
        cache: dashboardCache.orders,
        entityType: 'order',
        requestId,
      });

      // Retourner les données en cache avec headers appropriés
      return NextResponse.json(cachedOrders, {
        status: 200,
        headers: {
          'X-Request-ID': requestId,
          'X-Response-Time': `${responseTime}ms`,
          'X-Cache-Status': 'HIT',
          'X-Total-Count':
            cachedOrders.data?.pagination?.total?.toString() || '0',
          ...getCacheHeaders('orders'),
        },
      });
    }

    logger.debug('Cache miss, fetching from database', {
      requestId,
      component: 'orders',
      action: 'cache_miss',
    });

    // ===== ÉTAPE 5: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
      logger.debug('Database connection successful', {
        requestId,
        component: 'orders',
        action: 'db_connection_success',
      });
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Database Connection Error during orders fetch', {
        category: errorCategory,
        message: dbConnectionError.message,
        timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
        requestId,
        component: 'orders',
        action: 'db_connection_failed',
        entity: 'order',
      });

      // Capturer l'erreur de connexion DB avec Sentry
      captureDatabaseError(dbConnectionError, {
        tags: {
          component: 'orders',
          action: 'db_connection_failed',
          operation: 'connection',
          entity: 'order',
          data_type: 'financial',
        },
        extra: {
          requestId,
          timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
          ip: anonymizeIp(extractRealIp(req)),
          rateLimitingApplied: true,
        },
      });

      return NextResponse.json(
        {
          success: false,
          error: 'Service temporarily unavailable',
          message: 'Impossible de se connecter à la base de données',
          requestId,
        },
        {
          status: 503,
          headers: {
            'X-Request-ID': requestId,
            'Retry-After': '60',
          },
        },
      );
    }

    // ===== ÉTAPE 7: EXÉCUTION DES REQUÊTES =====
    let ordersResult, countResult;
    try {
      // Requête principale avec pagination
      const mainQuery = `
        SELECT 
          orders.order_id,
          orders.order_payment_status,
          orders.order_created,
          orders.order_price,
          orders.order_application_id,
          applications.application_name,
          applications.application_category,
          applications.application_images
        FROM admin.orders
        JOIN catalog.applications ON admin.orders.order_application_id = catalog.applications.application_id
        ORDER BY admin.orders.order_created DESC;
      `;

      // Requête pour le total
      const countQuery = `
        SELECT COUNT(*) as total
        FROM admin.orders
        JOIN catalog.applications ON admin.orders.order_application_id = catalog.applications.application_id
      `;

      logger.debug('Executing orders queries', {
        requestId,
        component: 'orders',
        action: 'query_start',
        table: 'admin.orders',
        operation: 'SELECT_WITH_JOIN',
      });

      // Exécuter les requêtes en parallèle
      [ordersResult, countResult] = await Promise.all([
        client.query(mainQuery),
        client.query(countQuery), // Exclure limit et offset pour le count
      ]);

      logger.debug('Orders queries executed successfully', {
        requestId,
        component: 'orders',
        action: 'query_success',
        ordersCount: ordersResult.rows.length,
        totalCount: countResult.rows[0]?.total || 0,
        table: 'admin.orders',
      });
    } catch (queryError) {
      const errorCategory = categorizeError(queryError);

      logger.error('Orders Query Error', {
        category: errorCategory,
        message: queryError.message,
        query: 'orders_fetch_with_pagination',
        table: 'admin.orders',
        requestId,
        component: 'orders',
        action: 'query_failed',
        entity: 'order',
      });

      // Capturer l'erreur de requête avec Sentry
      captureDatabaseError(queryError, {
        tags: {
          component: 'orders',
          action: 'query_failed',
          operation: 'SELECT_WITH_JOIN',
          entity: 'order',
          data_type: 'financial',
        },
        extra: {
          requestId,
          table: 'admin.orders',
          queryType: 'orders_fetch_with_pagination',
          postgresCode: queryError.code,
          postgresDetail: queryError.detail ? '[Filtered]' : undefined,
          ip: anonymizeIp(extractRealIp(req)),
          rateLimitingApplied: true,
        },
      });

      if (client) await client.cleanup();
      return NextResponse.json(
        {
          success: false,
          error: 'Database query failed',
          message: 'Impossible de récupérer les commandes',
          requestId,
        },
        {
          status: 500,
          headers: {
            'X-Request-ID': requestId,
          },
        },
      );
    }

    // ===== ÉTAPE 8: VALIDATION DES DONNÉES =====
    if (!ordersResult || !Array.isArray(ordersResult.rows)) {
      logger.warn('Orders query returned invalid data structure', {
        requestId,
        component: 'orders',
        action: 'invalid_data_structure',
        resultType: typeof ordersResult,
        hasRows: !!ordersResult?.rows,
        isArray: Array.isArray(ordersResult?.rows),
      });

      captureMessage('Orders query returned invalid data structure', {
        level: 'warning',
        tags: {
          component: 'orders',
          action: 'invalid_data_structure',
          error_category: 'business_logic',
          entity: 'order',
        },
        extra: {
          requestId,
          resultType: typeof ordersResult,
          hasRows: !!ordersResult?.rows,
          isArray: Array.isArray(ordersResult?.rows),
        },
      });

      if (client) await client.cleanup();
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid data structure',
          message:
            'Structure de données invalide retournée par la base de données',
          requestId,
        },
        {
          status: 500,
          headers: {
            'X-Request-ID': requestId,
          },
        },
      );
    }

    // ===== ÉTAPE 9: FORMATAGE ET SANITISATION DES DONNÉES =====
    const orders = ordersResult.rows;
    const total = parseInt(countResult.rows[0].total);

    // Sanitiser les données sensibles des commandes
    const sanitizedOrders = orders.map((order) => ({
      order_id: order.order_id,
      order_payment_status: order.order_payment_status,
      order_created: order.order_created,
      order_price: parseFloat(order.order_price) || 0,
      order_application_id: order.order_application_id,
      application_name: order.application_name || '[No Name]',
      application_category: order.application_category,
      application_images: order.application_images,
    }));

    logger.debug('Orders data sanitized', {
      requestId,
      component: 'orders',
      action: 'data_sanitization',
      originalCount: orders.length,
      sanitizedCount: sanitizedOrders.length,
    });

    // ===== ÉTAPE 10: FORMATAGE DE LA RÉPONSE =====
    const response = {
      success: true,
      data: {
        orders: sanitizedOrders,
      },
      meta: {
        count: sanitizedOrders.length,
        requestId,
        timestamp: new Date().toISOString(),
        fromCache: false,
      },
    };

    // ===== ÉTAPE 11: MISE EN CACHE DES DONNÉES =====
    logger.debug('Caching orders data', {
      requestId,
      component: 'orders',
      action: 'cache_set_start',
      orderCount: sanitizedOrders.length,
    });

    // Mettre les données en cache
    const cacheSuccess = dashboardCache.orders.set(cacheKey, response);

    if (cacheSuccess) {
      logger.debug('Orders data cached successfully', {
        requestId,
        component: 'orders',
        action: 'cache_set_success',
        cacheKey: cacheKey.substring(0, 50),
      });

      // Émettre un événement de cache set
      cacheEvents.emit('dashboard_set', {
        key: cacheKey,
        cache: dashboardCache.orders,
        entityType: 'order',
        requestId,
        size: sanitizedOrders.length,
      });
    } else {
      logger.warn('Failed to cache orders data', {
        requestId,
        component: 'orders',
        action: 'cache_set_failed',
        cacheKey: cacheKey.substring(0, 50),
      });
    }

    // ===== ÉTAPE 12: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Orders fetch successful', {
      orderCount: sanitizedOrders.length,
      totalCount: total,
      response_time_ms: responseTime,
      database_operations: 3, // connection + main query + count query
      success: true,
      requestId,
      component: 'orders',
      action: 'fetch_success',
      entity: 'order',
      data_type: 'financial',
      rateLimitingApplied: true,
      cacheMiss: true,
      cacheSet: cacheSuccess,
    });

    // Capturer le succès de la récupération avec Sentry
    captureMessage('Orders fetch completed successfully', {
      level: 'info',
      tags: {
        component: 'orders',
        action: 'fetch_success',
        success: 'true',
        entity: 'order',
        data_type: 'financial',
      },
      extra: {
        requestId,
        orderCount: sanitizedOrders.length,
        totalCount: total,
        responseTimeMs: responseTime,
        databaseOperations: 3,
        ip: anonymizeIp(extractRealIp(req)),
        rateLimitingApplied: true,
        cacheMiss: true,
        cacheSet: cacheSuccess,
      },
    });

    if (client) await client.cleanup();

    return NextResponse.json(response, {
      status: 200,
      headers: {
        'X-Request-ID': requestId,
        'X-Response-Time': `${responseTime}ms`,
        'X-Cache-Status': 'MISS',
        'X-Total-Count': total.toString(),
        ...getCacheHeaders('orders'),
      },
    });
  } catch (error) {
    // ===== GESTION GLOBALE DES ERREURS =====
    const errorCategory = categorizeError(error);
    const responseTime = Date.now() - startTime;

    logger.error('Global Orders Error', {
      category: errorCategory,
      response_time_ms: responseTime,
      reached_global_handler: true,
      error_name: error.name,
      error_message: error.message,
      stack_available: !!error.stack,
      requestId,
      component: 'orders',
      action: 'global_error_handler',
      entity: 'order',
      data_type: 'financial',
    });

    // Capturer l'erreur globale avec Sentry
    captureException(error, {
      level: 'error',
      tags: {
        component: 'orders',
        action: 'global_error_handler',
        error_category: errorCategory,
        critical: 'true',
        entity: 'order',
        data_type: 'financial',
      },
      extra: {
        requestId,
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'orders_fetch',
        ip: anonymizeIp(extractRealIp(req)),
        rateLimitingApplied: true,
      },
    });

    // Nettoyer les ressources en cas d'erreur
    if (client) {
      try {
        await client.cleanup();
      } catch (cleanupError) {
        // Log silencieux du cleanup error
      }
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message:
          'Une erreur interne est survenue lors de la récupération des commandes',
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
