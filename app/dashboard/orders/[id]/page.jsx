import EditOrder from '@/ui/pages/orders/EditOrder';
import { getServerSession } from 'next-auth';
import { auth } from '@app/api/auth/[...nextauth]/route';
import { getClient } from '@backend/dbConnect';
import { redirect, notFound } from 'next/navigation';
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
 * ✅ MISE À JOUR: Utilise la nouvelle architecture Sentry
 * @param {string} orderId - L'ID de la commande à récupérer
 * @returns {Promise<Object|null>} Commande ou null si non trouvée/erreur
 */
async function getOrderFromDatabase(orderId) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();

  logger.info('Order by ID fetch process started', {
    requestId,
    orderId: orderId || 'missing',
  });

  // ✅ NOUVEAU: Utilisation des fonctions Sentry adaptées
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
    if (!orderId) {
      logger.warn('Order ID parameter missing', {
        requestId,
      });

      // ✅ NOUVEAU: captureMessage pour les problèmes de validation
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
      logger.warn('Order ID format invalid', {
        requestId,
        providedId: orderId.substring(0, 10),
      });

      // ✅ NOUVEAU: captureMessage pour les problèmes de validation
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

    // ===== ÉTAPE 2: VÉRIFICATION DU CACHE =====
    const cacheKey = getDashboardCacheKey('single_order', {
      endpoint: 'server_component_order_by_id',
      orderId: cleanedOrderId,
      version: '1.0',
    });

    // Vérifier si les données sont en cache
    const cachedOrder = dashboardCache.orders.get(cacheKey);

    if (cachedOrder) {
      const responseTime = Date.now() - startTime;

      logger.info('Order served from cache', {
        orderId: cleanedOrderId.substring(0, 8),
        paymentStatus: cachedOrder.order_payment_status,
        response_time_ms: responseTime,
        requestId,
      });

      // ✅ NOUVEAU: captureMessage adapté pour Server Components
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

    // ===== ÉTAPE 3: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Database Connection Error during order fetch by ID', {
        category: errorCategory,
        message: dbConnectionError.message,
        requestId,
        orderId: cleanedOrderId.substring(0, 8),
      });

      // ✅ NOUVEAU: captureDatabaseError adapté pour Server Components
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
          p.platform_number
          
        FROM admin.orders o
        JOIN catalog.applications a ON o.order_application_id = a.application_id
        JOIN admin.platforms p ON o.order_platform_id = p.platform_id
        WHERE o.order_id = $1
      `;

      orderResult = await client.query(orderQuery, [cleanedOrderId]);
    } catch (queryError) {
      const errorCategory = categorizeError(queryError);

      logger.error('Order Fetch By ID Query Error', {
        category: errorCategory,
        message: queryError.message,
        orderId: cleanedOrderId.substring(0, 8),
        requestId,
      });

      // ✅ NOUVEAU: captureDatabaseError avec contexte spécifique
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
      logger.warn('Order not found', {
        requestId,
        orderId: cleanedOrderId.substring(0, 8),
      });

      // ✅ NOUVEAU: captureMessage pour les problèmes de logique métier
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
      logger.warn('Failed to parse client data', {
        requestId,
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

    // ===== ÉTAPE 7: MISE EN CACHE DES DONNÉES =====
    // Mettre les données en cache (TTL court pour données financières)
    const cacheSuccess = dashboardCache.orders.set(cacheKey, sanitizedOrder);

    if (!cacheSuccess) {
      logger.warn('Failed to cache order data', {
        requestId,
        orderId: cleanedOrderId.substring(0, 8),
      });
    }

    // ===== ÉTAPE 8: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Order fetch by ID successful', {
      orderId: cleanedOrderId.substring(0, 8),
      paymentStatus: sanitizedOrder.order_payment_status,
      orderPrice: sanitizedOrder.order_price,
      response_time_ms: responseTime,
      requestId,
    });

    // ✅ NOUVEAU: captureMessage de succès
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

    logger.error('Global Order By ID Error', {
      category: errorCategory,
      response_time_ms: responseTime,
      error_message: error.message,
      requestId,
      orderId: orderId ? orderId.substring(0, 8) : 'unknown',
    });

    // ✅ NOUVEAU: captureException adapté pour Server Components
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
 * ✅ MISE À JOUR: Utilise la nouvelle architecture Sentry
 * @returns {Promise<Object|null>} Session utilisateur ou null si non authentifié
 */
async function checkAuthentication() {
  try {
    const session = await getServerSession(auth);

    if (!session) {
      logger.warn('Unauthenticated access attempt to order edit page');

      // ✅ NOUVEAU: captureMessage pour tentative d'accès non authentifiée
      captureMessage('Unauthenticated access attempt to order edit page', {
        level: 'warning',
        tags: {
          component: 'order_by_id_server_component',
          action: 'auth_check_failed',
          error_category: 'authentication',
          execution_context: 'server_component',
        },
        extra: {
          timestamp: new Date().toISOString(),
          page: 'order_edit',
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
        component: 'order_by_id_server_component',
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
 * Server Component principal pour la page d'édition d'une commande
 * ✅ NOUVEAU: Wrappé avec monitoring automatique
 */
const EditOrderPageComponent = async ({ params }) => {
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
    logger.info('Order edit page rendering', {
      orderId: order.order_id.substring(0, 8),
      paymentStatus: order.order_payment_status,
      orderPrice: order.order_price,
      userId: session.user?.id,
    });

    return <EditOrder order={order} />;
  } catch (error) {
    // Gestion des erreurs au niveau de la page
    logger.error('Order edit page error', {
      error: error.message,
    });

    // ✅ NOUVEAU: captureServerComponentError pour erreurs de rendu
    captureServerComponentError(error, {
      componentName: 'EditOrderPage',
      route: '/dashboard/orders/[id]',
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

    // En cas d'erreur critique, rediriger vers 404
    notFound();
  }
};

// ✅ NOUVEAU: Export du composant avec monitoring automatique
const EditOrderPage = withServerComponentMonitoring(
  EditOrderPageComponent,
  'EditOrderPage',
);

export default EditOrderPage;
