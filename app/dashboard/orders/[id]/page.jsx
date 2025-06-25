import EditOrder from '@/ui/pages/orders/EditOrder';
import { getServerSession } from 'next-auth';
import { auth } from '@app/api/auth/[...nextauth]/route';
import { getClient } from '@backend/dbConnect';
import { redirect, notFound } from 'next/navigation';
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
 * Valide un UUID pour les commandes
 * @param {string} orderId - L'ID de la commande à valider
 * @returns {boolean} - True si l'UUID est valide
 */
function validateOrderId(orderId) {
  if (!orderId || typeof orderId !== 'string') {
    return false;
  }

  // Validation du format UUID
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(orderId);
}

/**
 * Nettoie et valide un UUID
 * @param {string} orderId - L'ID à nettoyer
 * @returns {string|null} - UUID nettoyé ou null si invalide
 */
function cleanOrderUUID(orderId) {
  if (!orderId || typeof orderId !== 'string') {
    return null;
  }

  // Supprimer les espaces et caractères indésirables
  const cleaned = orderId.trim().toLowerCase();

  // Valider le format UUID
  if (validateOrderId(cleaned)) {
    return cleaned;
  }

  return null;
}

/**
 * Fonction pour récupérer une commande spécifique depuis la base de données
 * Cette fonction remplace l'appel API et s'exécute directement côté serveur
 * @param {string} orderId - L'ID de la commande à récupérer
 * @returns {Promise<Object|null>} Commande ou null si non trouvée/erreur
 */
async function getOrderFromDatabase(orderId) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();

  logger.info('Order by ID fetch process started (Server Component)', {
    timestamp: new Date().toISOString(),
    requestId,
    component: 'order_by_id_server_component',
    action: 'fetch_start',
    method: 'SERVER_COMPONENT',
    operation: 'get_order_by_id',
    orderId: orderId || 'missing',
  });

  // Capturer le début du processus de récupération de la commande
  captureMessage('Get order by ID process started from Server Component', {
    level: 'info',
    tags: {
      component: 'order_by_id_server_component',
      action: 'process_start',
      entity: 'order',
      data_type: 'financial',
      execution_context: 'server_component',
      operation: 'read',
    },
    extra: {
      requestId,
      orderId: orderId || 'missing',
      timestamp: new Date().toISOString(),
      method: 'SERVER_COMPONENT',
    },
  });

  try {
    // ===== ÉTAPE 1: VALIDATION DE L'ID =====
    logger.debug('Validating order ID (Server Component)', {
      requestId,
      component: 'order_by_id_server_component',
      action: 'id_validation_start',
      operation: 'get_order_by_id',
      providedId: orderId || 'missing',
    });

    if (!orderId) {
      logger.warn('Order ID parameter missing (Server Component)', {
        requestId,
        component: 'order_by_id_server_component',
        action: 'id_validation_failed',
        reason: 'missing_parameter',
        operation: 'get_order_by_id',
      });

      // Capturer l'ID manquant avec Sentry
      captureMessage('Order ID parameter missing (Server Component)', {
        level: 'warning',
        tags: {
          component: 'order_by_id_server_component',
          action: 'id_validation_failed',
          error_category: 'validation',
          entity: 'order',
          data_type: 'financial',
          operation: 'read',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          reason: 'missing_parameter',
        },
      });

      // ID manquant, retourner null pour déclencher notFound()
      return null;
    }

    // Nettoyer l'UUID pour garantir le format correct
    const cleanedOrderId = cleanOrderUUID(orderId);
    if (!cleanedOrderId) {
      logger.warn('Order ID format invalid (Server Component)', {
        requestId,
        component: 'order_by_id_server_component',
        action: 'id_validation_failed',
        reason: 'invalid_uuid_format',
        operation: 'get_order_by_id',
        providedId: orderId.substring(0, 10), // Tronquer pour les logs
      });

      // Capturer l'erreur de format avec Sentry
      captureMessage('Order ID format invalid (Server Component)', {
        level: 'warning',
        tags: {
          component: 'order_by_id_server_component',
          action: 'id_validation_failed',
          error_category: 'validation',
          entity: 'order',
          data_type: 'financial',
          operation: 'read',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          providedId: orderId.substring(0, 10),
          reason: 'invalid_uuid_format',
        },
      });

      // ID invalide, retourner null pour déclencher notFound()
      return null;
    }

    logger.debug('Order ID validation and cleaning passed (Server Component)', {
      requestId,
      component: 'order_by_id_server_component',
      action: 'id_validation_success',
      operation: 'get_order_by_id',
      originalId: orderId.substring(0, 10),
      cleanedId: cleanedOrderId.substring(0, 10),
    });

    // ===== ÉTAPE 2: VÉRIFICATION DU CACHE =====
    const cacheKey = getDashboardCacheKey('single_order', {
      endpoint: 'server_component_order_by_id',
      orderId: cleanedOrderId,
      version: '1.0',
    });

    logger.debug('Checking cache for order by ID (Server Component)', {
      requestId,
      component: 'order_by_id_server_component',
      action: 'cache_check_start',
      cacheKey: cacheKey.substring(0, 50), // Tronquer pour les logs
      orderId: cleanedOrderId.substring(0, 8),
    });

    // Vérifier si les données sont en cache
    const cachedOrder = dashboardCache.orders.get(cacheKey);

    if (cachedOrder) {
      const responseTime = Date.now() - startTime;

      logger.info('Order served from cache (Server Component)', {
        orderId: cleanedOrderId.substring(0, 8),
        paymentStatus: cachedOrder.order_payment_status,
        response_time_ms: responseTime,
        cache_hit: true,
        requestId,
        component: 'order_by_id_server_component',
        action: 'cache_hit',
        entity: 'order',
        data_type: 'financial',
      });

      // Capturer le succès du cache avec Sentry
      captureMessage(
        'Order by ID served from cache successfully (Server Component)',
        {
          level: 'info',
          tags: {
            component: 'order_by_id_server_component',
            action: 'cache_hit',
            success: 'true',
            entity: 'order',
            data_type: 'financial',
            execution_context: 'server_component',
            operation: 'read',
          },
          extra: {
            requestId,
            orderId: cleanedOrderId.substring(0, 8),
            paymentStatus: cachedOrder.order_payment_status,
            responseTimeMs: responseTime,
            cacheKey: cacheKey.substring(0, 50),
          },
        },
      );

      return cachedOrder;
    }

    logger.debug('Cache miss, fetching from database (Server Component)', {
      requestId,
      component: 'order_by_id_server_component',
      action: 'cache_miss',
      orderId: cleanedOrderId.substring(0, 8),
    });

    // ===== ÉTAPE 3: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
      logger.debug('Database connection successful (Server Component)', {
        requestId,
        component: 'order_by_id_server_component',
        action: 'db_connection_success',
        operation: 'get_order_by_id',
        orderId: cleanedOrderId.substring(0, 8),
      });
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error(
        'Database Connection Error during order fetch by ID (Server Component)',
        {
          category: errorCategory,
          message: dbConnectionError.message,
          timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
          requestId,
          component: 'order_by_id_server_component',
          action: 'db_connection_failed',
          operation: 'get_order_by_id',
          entity: 'order',
          data_type: 'financial',
          orderId: cleanedOrderId.substring(0, 8),
        },
      );

      // Capturer l'erreur de connexion DB avec Sentry
      captureDatabaseError(dbConnectionError, {
        tags: {
          component: 'order_by_id_server_component',
          action: 'db_connection_failed',
          operation: 'connection',
          entity: 'order',
          data_type: 'financial',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          orderId: cleanedOrderId.substring(0, 8),
          timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
        },
      });

      // Retourner null plutôt que de faire planter la page
      return null;
    }

    // ===== ÉTAPE 4: EXÉCUTION DE LA REQUÊTE =====
    let orderResult;
    try {
      // Requête complexe avec toutes les relations
      const orderQuery = `
        SELECT 
          -- Données de la commande
          o.order_id,
          o.order_client,
          o.order_platform_id,
          o.order_application_id,
          o.order_payment_name,
          o.order_payment_number,
          o.order_price,
          o.order_payment_status,
          o.order_cancel_reason,
          o.order_cancelled_at,
          o.order_paid_at,
          o.order_created,
          o.order_updated,
          
          -- Données de l'application
          a.application_name,
          a.application_category,
          a.application_images,
          a.application_description,
          a.application_fee,
          a.application_rent,
          a.application_link,
          a.application_level,
          
          -- Données de la plateforme de paiement
          p.platform_name,
          p.platform_type,
          p.platform_description,
          p.platform_fee_percentage,
          p.platform_currency,
          p.platform_status
          
        FROM admin.orders o
        JOIN catalog.applications a ON o.order_application_id = a.application_id
        JOIN admin.platforms p ON o.order_platform_id = p.platform_id
        WHERE o.order_id = $1
      `;

      logger.debug('Executing order fetch by ID query (Server Component)', {
        requestId,
        component: 'order_by_id_server_component',
        action: 'query_start',
        operation: 'get_order_by_id',
        orderId: cleanedOrderId.substring(0, 8),
        table: 'admin.orders',
        operation_type: 'SELECT_WITH_JOINS',
      });

      orderResult = await client.query(orderQuery, [cleanedOrderId]);

      logger.debug(
        'Order fetch by ID query executed successfully (Server Component)',
        {
          requestId,
          component: 'order_by_id_server_component',
          action: 'query_success',
          operation: 'get_order_by_id',
          orderId: cleanedOrderId.substring(0, 8),
          found: orderResult.rows.length > 0,
          table: 'admin.orders',
        },
      );
    } catch (queryError) {
      const errorCategory = categorizeError(queryError);

      logger.error('Order Fetch By ID Query Error (Server Component)', {
        category: errorCategory,
        message: queryError.message,
        query: 'order_fetch_by_id_with_relations',
        table: 'admin.orders',
        orderId: cleanedOrderId.substring(0, 8),
        requestId,
        component: 'order_by_id_server_component',
        action: 'query_failed',
        operation: 'get_order_by_id',
        entity: 'order',
        data_type: 'financial',
      });

      // Capturer l'erreur de requête avec Sentry
      captureDatabaseError(queryError, {
        tags: {
          component: 'order_by_id_server_component',
          action: 'query_failed',
          operation: 'SELECT_WITH_JOINS',
          entity: 'order',
          data_type: 'financial',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          orderId: cleanedOrderId.substring(0, 8),
          table: 'admin.orders',
          queryType: 'order_fetch_by_id_with_relations',
          postgresCode: queryError.code,
          postgresDetail: queryError.detail ? '[Filtered]' : undefined,
        },
      });

      if (client) await client.cleanup();
      return null; // Retourner null plutôt que de faire planter la page
    }

    // ===== ÉTAPE 5: VÉRIFICATION EXISTENCE DE LA COMMANDE =====
    if (orderResult.rows.length === 0) {
      logger.warn('Order not found (Server Component)', {
        requestId,
        component: 'order_by_id_server_component',
        action: 'order_not_found',
        operation: 'get_order_by_id',
        orderId: cleanedOrderId.substring(0, 8),
      });

      // Capturer la commande non trouvée avec Sentry
      captureMessage('Order not found (Server Component)', {
        level: 'warning',
        tags: {
          component: 'order_by_id_server_component',
          action: 'order_not_found',
          error_category: 'business_logic',
          entity: 'order',
          data_type: 'financial',
          operation: 'read',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          orderId: cleanedOrderId.substring(0, 8),
        },
      });

      if (client) await client.cleanup();
      return null; // Commande non trouvée
    }

    // ===== ÉTAPE 6: FORMATAGE ET SANITISATION DES DONNÉES =====
    const orderData = orderResult.rows[0];

    // Parser et valider les données client
    let clientInfo = null;
    try {
      if (orderData.order_client && Array.isArray(orderData.order_client)) {
        const [lastName, firstName, email, phone] = orderData.order_client;
        clientInfo = {
          lastName: lastName || '',
          firstName: firstName || '',
          email: email || '',
          phone: phone || '',
          fullName: `${firstName || ''} ${lastName || ''}`.trim() || 'N/A',
        };
      }
    } catch (clientParseError) {
      logger.warn('Failed to parse client data (Server Component)', {
        requestId,
        component: 'order_by_id_server_component',
        action: 'client_parse_error',
        error: clientParseError.message,
        orderId: cleanedOrderId.substring(0, 8),
      });

      clientInfo = {
        lastName: 'N/A',
        firstName: 'N/A',
        email: 'N/A',
        phone: 'N/A',
        fullName: 'N/A',
      };
    }

    // Sanitiser les données sensibles
    const sanitizedOrder = {
      // Informations de base de la commande
      order_id: orderData.order_id,
      order_price: parseFloat(orderData.order_price) || 0,
      order_payment_status: orderData.order_payment_status,
      order_cancel_reason: orderData.order_cancel_reason || null,
      order_cancelled_at: orderData.order_cancelled_at,
      order_paid_at: orderData.order_paid_at,
      order_created: orderData.order_created,
      order_updated: orderData.order_updated,

      // Informations client (partiellement anonymisées pour les logs)
      client: clientInfo,

      // Informations de paiement (masquées pour la sécurité)
      payment: {
        name: orderData.order_payment_name,
        // Masquer partiellement le numéro de paiement
        number: orderData.order_payment_number
          ? `****${orderData.order_payment_number.slice(-4)}`
          : 'N/A',
        platform_id: orderData.order_platform_id,
      },

      // Informations de l'application
      application: {
        id: orderData.order_application_id,
        name: orderData.application_name || '[No Name]',
        category: orderData.application_category,
        images: orderData.application_images,
        description: orderData.application_description,
        fee: parseFloat(orderData.application_fee) || 0,
        rent: parseFloat(orderData.application_rent) || 0,
        link: orderData.application_link,
        level: orderData.application_level,
      },

      // Informations de la plateforme de paiement
      platform: {
        id: orderData.order_platform_id,
        name: orderData.platform_name || '[No Name]',
        type: orderData.platform_type,
        description: orderData.platform_description,
        fee_percentage: parseFloat(orderData.platform_fee_percentage) || 0,
        currency: orderData.platform_currency || 'EUR',
        status: orderData.platform_status,
      },
    };

    logger.debug('Order data sanitized (Server Component)', {
      requestId,
      component: 'order_by_id_server_component',
      action: 'data_sanitization',
      operation: 'get_order_by_id',
      orderId: cleanedOrderId.substring(0, 8),
      hasClientData: !!clientInfo,
      paymentStatus: orderData.order_payment_status,
    });

    // ===== ÉTAPE 7: MISE EN CACHE DES DONNÉES =====
    logger.debug('Caching order data (Server Component)', {
      requestId,
      component: 'order_by_id_server_component',
      action: 'cache_set_start',
      orderId: cleanedOrderId.substring(0, 8),
    });

    // Mettre les données en cache (TTL court pour données financières)
    const cacheSuccess = dashboardCache.orders.set(cacheKey, sanitizedOrder);

    if (cacheSuccess) {
      logger.debug('Order data cached successfully (Server Component)', {
        requestId,
        component: 'order_by_id_server_component',
        action: 'cache_set_success',
        cacheKey: cacheKey.substring(0, 50),
        orderId: cleanedOrderId.substring(0, 8),
      });
    } else {
      logger.warn('Failed to cache order data (Server Component)', {
        requestId,
        component: 'order_by_id_server_component',
        action: 'cache_set_failed',
        cacheKey: cacheKey.substring(0, 50),
        orderId: cleanedOrderId.substring(0, 8),
      });
    }

    // ===== ÉTAPE 8: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Order fetch by ID successful (Server Component)', {
      orderId: cleanedOrderId.substring(0, 8),
      paymentStatus: sanitizedOrder.order_payment_status,
      orderPrice: sanitizedOrder.order_price,
      response_time_ms: responseTime,
      database_operations: 2, // connection + query
      success: true,
      requestId,
      component: 'order_by_id_server_component',
      action: 'fetch_by_id_success',
      entity: 'order',
      data_type: 'financial',
      cacheMiss: true,
      cacheSet: cacheSuccess,
      execution_context: 'server_component',
      operation: 'get_order_by_id',
      validationApplied: true,
    });

    // Capturer le succès de la récupération avec Sentry
    captureMessage(
      'Order fetch by ID completed successfully (Server Component)',
      {
        level: 'info',
        tags: {
          component: 'order_by_id_server_component',
          action: 'fetch_by_id_success',
          success: 'true',
          entity: 'order',
          data_type: 'financial',
          operation: 'read',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          orderId: cleanedOrderId.substring(0, 8),
          paymentStatus: sanitizedOrder.order_payment_status,
          orderPrice: sanitizedOrder.order_price,
          responseTimeMs: responseTime,
          databaseOperations: 2,
          cacheMiss: true,
          cacheSet: cacheSuccess,
        },
      },
    );

    if (client) await client.cleanup();

    return sanitizedOrder;
  } catch (error) {
    // ===== GESTION GLOBALE DES ERREURS =====
    const errorCategory = categorizeError(error);
    const responseTime = Date.now() - startTime;

    logger.error('Global Order By ID Error (Server Component)', {
      category: errorCategory,
      response_time_ms: responseTime,
      reached_global_handler: true,
      error_name: error.name,
      error_message: error.message,
      stack_available: !!error.stack,
      requestId,
      orderId: orderId ? orderId.substring(0, 8) : 'unknown',
      component: 'order_by_id_server_component',
      action: 'global_error_handler',
      entity: 'order',
      data_type: 'financial',
      operation: 'get_order_by_id',
      execution_context: 'server_component',
    });

    // Capturer l'erreur globale avec Sentry
    captureException(error, {
      level: 'error',
      tags: {
        component: 'order_by_id_server_component',
        action: 'global_error_handler',
        error_category: errorCategory,
        critical: 'true',
        entity: 'order',
        data_type: 'financial',
        operation: 'read',
        execution_context: 'server_component',
      },
      extra: {
        requestId,
        orderId: orderId ? orderId.substring(0, 8) : 'unknown',
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'order_fetch_by_id_server_component',
      },
    });

    if (client) await client.cleanup();

    // En cas d'erreur grave, retourner null pour déclencher notFound()
    return null;
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
      logger.warn('Unauthenticated access attempt to order edit page', {
        component: 'order_by_id_server_component',
        action: 'auth_check_failed',
        timestamp: new Date().toISOString(),
      });

      // Capturer la tentative d'accès non authentifiée
      captureMessage('Unauthenticated access attempt to order edit page', {
        level: 'warning',
        tags: {
          component: 'order_by_id_server_component',
          action: 'auth_check_failed',
          error_category: 'authentication',
        },
        extra: {
          timestamp: new Date().toISOString(),
          page: 'order_edit',
        },
      });

      return null;
    }

    logger.debug(
      'User authentication verified successfully (Server Component)',
      {
        userId: session.user?.id,
        email: session.user?.email?.substring(0, 3) + '***',
        component: 'order_by_id_server_component',
        action: 'auth_verification_success',
      },
    );

    return session;
  } catch (error) {
    logger.error('Authentication check error (Server Component)', {
      error: error.message,
      component: 'order_by_id_server_component',
      action: 'auth_check_error',
    });

    captureException(error, {
      level: 'error',
      tags: {
        component: 'order_by_id_server_component',
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
 * Server Component principal pour la page d'édition d'une commande
 * Cette fonction s'exécute côté serveur et remplace l'appel API
 */
const EditOrderPage = async ({ params }) => {
  try {
    // Attendre les paramètres (requis en Next.js 15)
    const { id } = await params;

    // ===== ÉTAPE 1: VÉRIFICATION AUTHENTIFICATION =====
    const session = await checkAuthentication();

    if (!session) {
      // Rediriger vers la page de login si non authentifié
      redirect('/login');
    }

    // ===== ÉTAPE 2: RÉCUPÉRATION DE LA COMMANDE =====
    const order = await getOrderFromDatabase(id);

    // ===== ÉTAPE 3: VÉRIFICATION EXISTENCE =====
    if (!order) {
      // Commande non trouvée ou ID invalide, afficher 404
      notFound();
    }

    // ===== ÉTAPE 4: RENDU DE LA PAGE =====
    logger.info('Order edit page rendering (Server Component)', {
      orderId: order.order_id.substring(0, 8),
      paymentStatus: order.order_payment_status,
      orderPrice: order.order_price,
      userId: session.user?.id,
      component: 'order_by_id_server_component',
      action: 'page_render',
      timestamp: new Date().toISOString(),
    });

    return <EditOrder order={order} />;
  } catch (error) {
    // Gestion des erreurs au niveau de la page
    logger.error('Order edit page error (Server Component)', {
      error: error.message,
      stack: error.stack,
      component: 'order_by_id_server_component',
      action: 'page_error',
    });

    captureException(error, {
      level: 'error',
      tags: {
        component: 'order_by_id_server_component',
        action: 'page_error',
        error_category: 'page_rendering',
        critical: 'true',
      },
      extra: {
        errorMessage: error.message,
        stackAvailable: !!error.stack,
      },
    });

    // En cas d'erreur critique, rediriger vers 404
    notFound();
  }
};

export default EditOrderPage;
