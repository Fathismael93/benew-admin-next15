import OrdersList from '@/ui/pages/orders/OrdersList';
import { getServerSession } from 'next-auth';
import { auth } from '@app/api/auth/[...nextauth]/route';
import { getClient } from '@backend/dbConnect';
import { redirect } from 'next/navigation';
import {
  captureException,
  captureMessage,
  captureDatabaseError,
} from '@/monitoring/sentry';
import {
  categorizeError,
  generateRequestId,
  // anonymizeIp,
} from '@/utils/helpers';
import logger from '@/utils/logger';
import {
  dashboardCache,
  getDashboardCacheKey,
  // invalidateDashboardCache,
} from '@/utils/cache';

// Configuration de revalidation pour cette page
export const revalidate = 0; // Désactive le cache statique
export const dynamic = 'force-dynamic'; // Force le rendu dynamique

/**
 * Fonction pour récupérer les commandes depuis la base de données
 * Cette fonction remplace l'appel API et s'exécute directement côté serveur
 * @returns {Promise<Object>} Objet contenant les commandes et le total ou données vides en cas d'erreur
 */
async function getOrdersFromDatabase() {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();

  logger.info('Orders fetch process started (Server Component)', {
    timestamp: new Date().toISOString(),
    requestId,
    component: 'orders_server_component',
    action: 'fetch_start',
    method: 'SERVER_COMPONENT',
  });

  // Capturer le début du processus de récupération des commandes
  captureMessage('Orders fetch process started from Server Component', {
    level: 'info',
    tags: {
      component: 'orders_server_component',
      action: 'process_start',
      entity: 'order',
      data_type: 'financial',
      execution_context: 'server_component',
    },
    extra: {
      requestId,
      timestamp: new Date().toISOString(),
      method: 'SERVER_COMPONENT',
    },
  });

  try {
    // ===== ÉTAPE 1: VÉRIFICATION DU CACHE =====
    const cacheKey = getDashboardCacheKey('orders_list', {
      endpoint: 'server_component_orders',
      status: 'all',
      version: '1.0',
    });

    logger.debug('Checking cache for orders (Server Component)', {
      requestId,
      component: 'orders_server_component',
      action: 'cache_check_start',
      cacheKey: cacheKey.substring(0, 50), // Tronquer pour les logs
    });

    // Vérifier si les données sont en cache
    const cachedOrders = dashboardCache.orders.get(cacheKey);

    if (cachedOrders) {
      const responseTime = Date.now() - startTime;

      logger.info('Orders served from cache (Server Component)', {
        orderCount: cachedOrders.orders?.length || 0,
        totalCount: cachedOrders.totalOrders || 0,
        response_time_ms: responseTime,
        cache_hit: true,
        requestId,
        component: 'orders_server_component',
        action: 'cache_hit',
        entity: 'order',
        data_type: 'financial',
      });

      // Capturer le succès du cache avec Sentry
      captureMessage(
        'Orders served from cache successfully (Server Component)',
        {
          level: 'info',
          tags: {
            component: 'orders_server_component',
            action: 'cache_hit',
            success: 'true',
            entity: 'order',
            data_type: 'financial',
            execution_context: 'server_component',
          },
          extra: {
            requestId,
            orderCount: cachedOrders.orders?.length || 0,
            totalCount: cachedOrders.totalOrders || 0,
            responseTimeMs: responseTime,
            cacheKey: cacheKey.substring(0, 50),
          },
        },
      );

      return cachedOrders;
    }

    logger.debug('Cache miss, fetching from database (Server Component)', {
      requestId,
      component: 'orders_server_component',
      action: 'cache_miss',
    });

    // ===== ÉTAPE 2: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
      logger.debug('Database connection successful (Server Component)', {
        requestId,
        component: 'orders_server_component',
        action: 'db_connection_success',
      });
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error(
        'Database Connection Error during orders fetch (Server Component)',
        {
          category: errorCategory,
          message: dbConnectionError.message,
          timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
          requestId,
          component: 'orders_server_component',
          action: 'db_connection_failed',
          entity: 'order',
          data_type: 'financial',
        },
      );

      // Capturer l'erreur de connexion DB avec Sentry
      captureDatabaseError(dbConnectionError, {
        tags: {
          component: 'orders_server_component',
          action: 'db_connection_failed',
          operation: 'connection',
          entity: 'order',
          data_type: 'financial',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
        },
      });

      // Retourner des données vides plutôt que de faire planter la page
      return { orders: [], totalOrders: 0 };
    }

    // ===== ÉTAPE 3: EXÉCUTION DES REQUÊTES =====
    let ordersResult, countResult;
    try {
      // Requête principale avec pagination et relations
      const mainQuery = `
        SELECT 
          -- Données de la commande
          orders.order_id,
          orders.order_payment_status,
          orders.order_created,
          orders.order_price,
          orders.order_application_id,
          
          -- Données de l'application
          applications.application_name,
          applications.application_category,
          applications.application_images
          
        FROM admin.orders
        JOIN catalog.applications ON admin.orders.order_application_id = catalog.applications.application_id
        ORDER BY admin.orders.order_created DESC
      `;

      // Requête pour le total
      const countQuery = `
        SELECT COUNT(*) as total
        FROM admin.orders
        JOIN catalog.applications ON admin.orders.order_application_id = catalog.applications.application_id
      `;

      logger.debug('Executing orders queries (Server Component)', {
        requestId,
        component: 'orders_server_component',
        action: 'query_start',
        table: 'admin.orders',
        operation: 'SELECT_WITH_JOIN',
      });

      // Exécuter les requêtes en parallèle
      [ordersResult, countResult] = await Promise.all([
        client.query(mainQuery),
        client.query(countQuery),
      ]);

      logger.debug('Orders queries executed successfully (Server Component)', {
        requestId,
        component: 'orders_server_component',
        action: 'query_success',
        ordersCount: ordersResult.rows.length,
        totalCount: countResult.rows[0]?.total || 0,
        table: 'admin.orders',
      });
    } catch (queryError) {
      const errorCategory = categorizeError(queryError);

      logger.error('Orders Query Error (Server Component)', {
        category: errorCategory,
        message: queryError.message,
        query: 'orders_fetch_with_relations',
        table: 'admin.orders',
        requestId,
        component: 'orders_server_component',
        action: 'query_failed',
        entity: 'order',
        data_type: 'financial',
      });

      // Capturer l'erreur de requête avec Sentry
      captureDatabaseError(queryError, {
        tags: {
          component: 'orders_server_component',
          action: 'query_failed',
          operation: 'SELECT_WITH_JOIN',
          entity: 'order',
          data_type: 'financial',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          table: 'admin.orders',
          queryType: 'orders_fetch_with_relations',
          postgresCode: queryError.code,
          postgresDetail: queryError.detail ? '[Filtered]' : undefined,
        },
      });

      if (client) await client.cleanup();
      return { orders: [], totalOrders: 0 }; // Retourner des données vides plutôt que de faire planter la page
    }

    // ===== ÉTAPE 4: VALIDATION DES DONNÉES =====
    if (!ordersResult || !Array.isArray(ordersResult.rows)) {
      logger.warn(
        'Orders query returned invalid data structure (Server Component)',
        {
          requestId,
          component: 'orders_server_component',
          action: 'invalid_data_structure',
          resultType: typeof ordersResult,
          hasRows: !!ordersResult?.rows,
          isArray: Array.isArray(ordersResult?.rows),
        },
      );

      captureMessage(
        'Orders query returned invalid data structure (Server Component)',
        {
          level: 'warning',
          tags: {
            component: 'orders_server_component',
            action: 'invalid_data_structure',
            error_category: 'business_logic',
            entity: 'order',
            data_type: 'financial',
            execution_context: 'server_component',
          },
          extra: {
            requestId,
            resultType: typeof ordersResult,
            hasRows: !!ordersResult?.rows,
            isArray: Array.isArray(ordersResult?.rows),
          },
        },
      );

      if (client) await client.cleanup();
      return { orders: [], totalOrders: 0 }; // Retourner des données vides plutôt que de faire planter la page
    }

    // ===== ÉTAPE 5: FORMATAGE ET SANITISATION DES DONNÉES =====
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

    logger.debug('Orders data sanitized (Server Component)', {
      requestId,
      component: 'orders_server_component',
      action: 'data_sanitization',
      originalCount: orders.length,
      sanitizedCount: sanitizedOrders.length,
    });

    // ===== ÉTAPE 6: FORMATAGE DE LA RÉPONSE =====
    const response = {
      orders: sanitizedOrders,
      totalOrders: total,
    };

    // ===== ÉTAPE 7: MISE EN CACHE DES DONNÉES =====
    logger.debug('Caching orders data (Server Component)', {
      requestId,
      component: 'orders_server_component',
      action: 'cache_set_start',
      orderCount: sanitizedOrders.length,
    });

    // Mettre les données en cache
    const cacheSuccess = dashboardCache.orders.set(cacheKey, response);

    if (cacheSuccess) {
      logger.debug('Orders data cached successfully (Server Component)', {
        requestId,
        component: 'orders_server_component',
        action: 'cache_set_success',
        cacheKey: cacheKey.substring(0, 50),
      });
    } else {
      logger.warn('Failed to cache orders data (Server Component)', {
        requestId,
        component: 'orders_server_component',
        action: 'cache_set_failed',
        cacheKey: cacheKey.substring(0, 50),
      });
    }

    // ===== ÉTAPE 8: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Orders fetch successful (Server Component)', {
      orderCount: sanitizedOrders.length,
      totalCount: total,
      response_time_ms: responseTime,
      database_operations: 3, // connection + main query + count query
      success: true,
      requestId,
      component: 'orders_server_component',
      action: 'fetch_success',
      entity: 'order',
      data_type: 'financial',
      cacheMiss: true,
      cacheSet: cacheSuccess,
      execution_context: 'server_component',
    });

    // Capturer le succès de la récupération avec Sentry
    captureMessage('Orders fetch completed successfully (Server Component)', {
      level: 'info',
      tags: {
        component: 'orders_server_component',
        action: 'fetch_success',
        success: 'true',
        entity: 'order',
        data_type: 'financial',
        execution_context: 'server_component',
      },
      extra: {
        requestId,
        orderCount: sanitizedOrders.length,
        totalCount: total,
        responseTimeMs: responseTime,
        databaseOperations: 3,
        cacheMiss: true,
        cacheSet: cacheSuccess,
      },
    });

    if (client) await client.cleanup();

    return response;
  } catch (error) {
    // ===== GESTION GLOBALE DES ERREURS =====
    const errorCategory = categorizeError(error);
    const responseTime = Date.now() - startTime;

    logger.error('Global Orders Error (Server Component)', {
      category: errorCategory,
      response_time_ms: responseTime,
      reached_global_handler: true,
      error_name: error.name,
      error_message: error.message,
      stack_available: !!error.stack,
      requestId,
      component: 'orders_server_component',
      action: 'global_error_handler',
      entity: 'order',
      data_type: 'financial',
      execution_context: 'server_component',
    });

    // Capturer l'erreur globale avec Sentry
    captureException(error, {
      level: 'error',
      tags: {
        component: 'orders_server_component',
        action: 'global_error_handler',
        error_category: errorCategory,
        critical: 'true',
        entity: 'order',
        data_type: 'financial',
        execution_context: 'server_component',
      },
      extra: {
        requestId,
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'orders_fetch_server_component',
      },
    });

    if (client) await client.cleanup();

    // En cas d'erreur grave, retourner des données vides pour éviter de casser la page
    // L'utilisateur verra une liste vide mais la page se chargera
    return { orders: [], totalOrders: 0 };
  }
}

/**
 * Fonction pour vérifier l'authentification côté serveur
 * @returns {Promise<Object|null>} Session utilisateur ou null si non authentifié
 */
async function checkAuthentication() {
  try {
    const session = await getServerSession(auth);

    if (!session) {
      logger.warn('Unauthenticated access attempt to orders page', {
        component: 'orders_server_component',
        action: 'auth_check_failed',
        timestamp: new Date().toISOString(),
      });

      // Capturer la tentative d'accès non authentifiée
      captureMessage('Unauthenticated access attempt to orders page', {
        level: 'warning',
        tags: {
          component: 'orders_server_component',
          action: 'auth_check_failed',
          error_category: 'authentication',
        },
        extra: {
          timestamp: new Date().toISOString(),
          page: 'orders',
        },
      });

      return null;
    }

    logger.debug(
      'User authentication verified successfully (Server Component)',
      {
        userId: session.user?.id,
        email: session.user?.email?.substring(0, 3) + '***',
        component: 'orders_server_component',
        action: 'auth_verification_success',
      },
    );

    return session;
  } catch (error) {
    logger.error('Authentication check error (Server Component)', {
      error: error.message,
      component: 'orders_server_component',
      action: 'auth_check_error',
    });

    captureException(error, {
      level: 'error',
      tags: {
        component: 'orders_server_component',
        action: 'auth_check_error',
        error_category: 'authentication',
      },
      extra: {
        errorMessage: error.message,
      },
    });

    return null;
  }
}

/**
 * Server Component principal pour la page des commandes
 * Cette fonction s'exécute côté serveur et remplace l'appel API
 */
const OrdersPage = async () => {
  try {
    // ===== ÉTAPE 1: VÉRIFICATION AUTHENTIFICATION =====
    const session = await checkAuthentication();

    if (!session) {
      // Rediriger vers la page de login si non authentifié
      redirect('/login');
    }

    // ===== ÉTAPE 2: RÉCUPÉRATION DES COMMANDES =====
    const { orders, totalOrders } = await getOrdersFromDatabase();

    // ===== ÉTAPE 3: RENDU DE LA PAGE =====
    logger.info('Orders page rendering (Server Component)', {
      orderCount: orders.length,
      totalCount: totalOrders,
      userId: session.user?.id,
      component: 'orders_server_component',
      action: 'page_render',
      timestamp: new Date().toISOString(),
    });

    return <OrdersList data={orders} totalOrders={totalOrders} />;
  } catch (error) {
    // Gestion des erreurs au niveau de la page
    logger.error('Orders page error (Server Component)', {
      error: error.message,
      stack: error.stack,
      component: 'orders_server_component',
      action: 'page_error',
    });

    captureException(error, {
      level: 'error',
      tags: {
        component: 'orders_server_component',
        action: 'page_error',
        error_category: 'page_rendering',
        critical: 'true',
      },
      extra: {
        errorMessage: error.message,
        stackAvailable: !!error.stack,
      },
    });

    // En cas d'erreur critique, afficher une page avec des données vides
    // plutôt que de faire planter complètement l'application
    return <OrdersList data={[]} totalOrders={0} />;
  }
};

export default OrdersPage;
