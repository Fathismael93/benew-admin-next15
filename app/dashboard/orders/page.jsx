import OrdersList from '@/ui/pages/orders/OrdersList';
import { getServerSession } from 'next-auth';
import { auth } from '@app/api/auth/[...nextauth]/route';
import { getClient } from '@backend/dbConnect';
import { redirect } from 'next/navigation';
import {
  captureException,
  captureMessage,
  captureDatabaseError,
  captureServerComponentError,
  withServerComponentMonitoring,
} from '@/monitoring/sentry';
import { categorizeError, generateRequestId } from '@/utils/helpers';
import logger from '@/utils/logger';
import { dashboardCache, getDashboardCacheKey } from '@/utils/cache';

// Configuration de revalidation pour cette page
export const revalidate = 0; // Désactive le cache statique
export const dynamic = 'force-dynamic'; // Force le rendu dynamique

/**
 * Fonction pour récupérer les commandes depuis la base de données
 * ✅ MISE À JOUR: Utilise la nouvelle architecture Sentry
 * @returns {Promise<Object>} Objet contenant les commandes et le total ou données vides en cas d'erreur
 */
async function getOrdersFromDatabase() {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();

  logger.info('Orders fetch process started', {
    requestId,
  });

  // ✅ NOUVEAU: Utilisation des fonctions Sentry adaptées
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

    // Vérifier si les données sont en cache
    const cachedOrders = dashboardCache.orders.get(cacheKey);

    if (cachedOrders) {
      const responseTime = Date.now() - startTime;

      logger.info('Orders served from cache', {
        orderCount: cachedOrders.orders?.length || 0,
        totalCount: cachedOrders.totalOrders || 0,
        response_time_ms: responseTime,
        requestId,
      });

      // ✅ NOUVEAU: captureMessage adapté pour Server Components
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

    // ===== ÉTAPE 2: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Database Connection Error during orders fetch', {
        category: errorCategory,
        message: dbConnectionError.message,
        requestId,
      });

      // ✅ NOUVEAU: captureDatabaseError adapté pour Server Components
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

      // Exécuter les requêtes en parallèle
      [ordersResult, countResult] = await Promise.all([
        client.query(mainQuery),
        client.query(countQuery),
      ]);
    } catch (queryError) {
      const errorCategory = categorizeError(queryError);

      logger.error('Orders Query Error', {
        category: errorCategory,
        message: queryError.message,
        requestId,
      });

      // ✅ NOUVEAU: captureDatabaseError avec contexte spécifique
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
      logger.warn('Orders query returned invalid data structure', {
        requestId,
        resultType: typeof ordersResult,
      });

      // ✅ NOUVEAU: captureMessage pour les problèmes de structure de données
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

    // ===== ÉTAPE 6: FORMATAGE DE LA RÉPONSE =====
    const response = {
      orders: sanitizedOrders,
      totalOrders: total,
    };

    // ===== ÉTAPE 7: MISE EN CACHE DES DONNÉES =====
    // Mettre les données en cache
    const cacheSuccess = dashboardCache.orders.set(cacheKey, response);

    if (!cacheSuccess) {
      logger.warn('Failed to cache orders data', {
        requestId,
      });
    }

    // ===== ÉTAPE 8: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Orders fetch successful', {
      orderCount: sanitizedOrders.length,
      totalCount: total,
      response_time_ms: responseTime,
      requestId,
    });

    // ✅ NOUVEAU: captureMessage de succès
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

    logger.error('Global Orders Error', {
      category: errorCategory,
      response_time_ms: responseTime,
      error_message: error.message,
      requestId,
    });

    // ✅ NOUVEAU: captureException adapté pour Server Components
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
 * ✅ MISE À JOUR: Utilise la nouvelle architecture Sentry
 * @returns {Promise<Object|null>} Session utilisateur ou null si non authentifié
 */
async function checkAuthentication() {
  try {
    const session = await getServerSession(auth);

    if (!session) {
      logger.warn('Unauthenticated access attempt to orders page');

      // ✅ NOUVEAU: captureMessage pour tentative d'accès non authentifiée
      captureMessage('Unauthenticated access attempt to orders page', {
        level: 'warning',
        tags: {
          component: 'orders_server_component',
          action: 'auth_check_failed',
          error_category: 'authentication',
          execution_context: 'server_component',
        },
        extra: {
          timestamp: new Date().toISOString(),
          page: 'orders',
        },
      });

      return null;
    }

    return session;
  } catch (error) {
    logger.error('Authentication check error', {
      error: error.message,
    });

    // ✅ NOUVEAU: captureException pour erreurs d'authentification
    captureException(error, {
      level: 'error',
      tags: {
        component: 'orders_server_component',
        action: 'auth_check_error',
        error_category: 'authentication',
        execution_context: 'server_component',
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
 * ✅ NOUVEAU: Wrappé avec monitoring automatique
 */
const OrdersPageComponent = async () => {
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
    logger.info('Orders page rendering', {
      orderCount: orders.length,
      totalCount: totalOrders,
      userId: session.user?.id,
    });

    return <OrdersList data={orders} totalOrders={totalOrders} />;
  } catch (error) {
    // Gestion des erreurs au niveau de la page
    logger.error('Orders page error', {
      error: error.message,
    });

    // ✅ NOUVEAU: captureServerComponentError pour erreurs de rendu
    captureServerComponentError(error, {
      componentName: 'OrdersPage',
      route: '/dashboard/orders',
      action: 'page_render',
      tags: {
        critical: 'true',
        page_type: 'dashboard',
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

// ✅ NOUVEAU: Export du composant avec monitoring automatique
const OrdersPage = withServerComponentMonitoring(
  OrdersPageComponent,
  'OrdersPage',
);

export default OrdersPage;
