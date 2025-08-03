'use server';

import { getClient } from '@backend/dbConnect';
import { getServerSession } from 'next-auth';
import { auth } from '@app/api/auth/[...nextauth]/route';
import {
  generateRequestId,
  categorizeError,
  anonymizeIp,
} from '@/utils/helpers';
import logger from '@/utils/logger';
import {
  captureException,
  captureMessage,
  captureDatabaseError,
} from '@/monitoring/sentry';
import {
  dashboardCache,
  getDashboardCacheKey,
  invalidateDashboardCache,
} from '@/utils/cache';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@backend/rateLimiter';

// Rate limiting spécifique aux Server Actions
const serverActionRateLimit = applyRateLimit(RATE_LIMIT_PRESETS.CONTENT_API, {
  prefix: 'server_action_orders',
  keyGenerator: (req) => {
    const ip = anonymizeIp(req.ip || '0.0.0.0');
    const sessionId = req.session?.user?.id || 'anonymous';
    return `orders_filter:${sessionId}:${ip}`;
  },
});

/**
 * Simule une requête pour le rate limiting des Server Actions
 * @param {Object} session - Session utilisateur
 * @returns {Object} - Objet requête simulé
 */
function createMockRequest(session) {
  return {
    ip: '127.0.0.1',
    session,
    url: '/server-action/getFilteredOrders',
    method: 'POST',
    headers: {
      'user-agent': 'NextJS-ServerAction',
    },
  };
}

/**
 * Validation avancée des filtres avec sécurité renforcée
 * @param {Object} filters - Filtres à valider
 * @returns {Object} - Filtres validés et nettoyés
 */
function validateAndSanitizeFilters(filters = {}) {
  const validatedFilters = {};
  const allowedFields = ['order_client', 'order_payment_status'];
  const maxStringLength = 100;
  const maxArrayLength = 10;

  for (const [key, value] of Object.entries(filters)) {
    // Vérifier que le champ est autorisé
    if (!allowedFields.includes(key)) {
      logger.warn(
        'Server Action: Tentative de filtrage avec champ non autorisé',
        {
          field: key,
          security_event: true,
        },
      );
      continue;
    }

    // Validation selon le type de champ
    switch (key) {
      case 'order_client':
        if (typeof value === 'string' && value.trim()) {
          const cleanValue = value.trim().substring(0, maxStringLength);
          const sanitizedValue = cleanValue.replace(/[<>"'%;()&+]/g, '');
          if (sanitizedValue.length >= 2) {
            validatedFilters[key] = sanitizedValue;
          }
        }
        break;

      case 'order_payment_status':
        if (Array.isArray(value)) {
          const allowedStatuses = ['paid', 'unpaid', 'refunded', 'failed'];
          const validValues = value
            .filter((v) => typeof v === 'string' && v.trim())
            .map((v) => v.trim())
            .slice(0, maxArrayLength);
          validatedFilters[key] = validValues.filter((v) =>
            allowedStatuses.includes(v),
          );
        }
        break;
    }
  }

  return validatedFilters;
}

/**
 * Construction sécurisée de la clause WHERE avec protection SQL injection
 * @param {Object} filters - Filtres validés
 * @returns {Object} - Objet contenant whereClause et values
 */
function buildSecureWhereClause(filters) {
  const conditions = [];
  const values = [];
  let paramCount = 1;

  // Recherche par client dans l'array order_client
  if (filters.order_client) {
    conditions.push(`array_to_string(order_client, ' ') ILIKE $${paramCount}`);
    values.push(`%${filters.order_client}%`);
    paramCount++;
  }

  // Filtre par statut de paiement (MULTIPLE) avec IN clause sécurisée
  if (filters.order_payment_status && filters.order_payment_status.length > 0) {
    const statusPlaceholders = filters.order_payment_status
      .map(() => `$${paramCount++}`)
      .join(', ');
    conditions.push(`order_payment_status IN (${statusPlaceholders})`);
    values.push(...filters.order_payment_status);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  return { whereClause, values };
}

/**
 * Génération de clé de cache intelligente basée sur les filtres
 * @param {Object} filters - Filtres appliqués
 * @returns {string} - Clé de cache unique
 */
function generateFilterCacheKey(filters) {
  const sortedFilters = {};
  Object.keys(filters)
    .sort()
    .forEach((key) => {
      if (Array.isArray(filters[key])) {
        sortedFilters[key] = [...filters[key]].sort();
      } else {
        sortedFilters[key] = filters[key];
      }
    });

  return getDashboardCacheKey('orders_filtered', {
    filters: JSON.stringify(sortedFilters),
    version: '2.0',
  });
}

/**
 * Authentification et autorisation pour Server Actions
 * @param {Object} context - Contexte de la requête (optionnel pour Server Actions)
 * @returns {Promise<Object>} - Session utilisateur validée
 */
async function authenticateServerAction(context = {}) {
  const requestId = generateRequestId();

  try {
    const session = await getServerSession(auth);

    if (!session || !session.user) {
      logger.warn("Server Action: Tentative d'accès non authentifiée", {
        requestId,
      });

      captureMessage('Unauthenticated access attempt to Server Action', {
        level: 'warning',
        tags: {
          component: 'orders_server_action',
          action: 'auth_check_failed',
          error_category: 'authentication',
          execution_context: 'server_action',
        },
        extra: {
          requestId,
          timestamp: new Date().toISOString(),
          serverAction: 'getFilteredOrders',
          context,
        },
      });

      throw new Error('Authentication required for this action');
    }

    // Validation supplémentaire de la session
    if (!session.user.id || !session.user.email) {
      logger.error('Server Action: Session utilisateur incomplète', {
        requestId,
        hasUserId: !!session.user.id,
        hasUserEmail: !!session.user.email,
      });

      throw new Error('Invalid user session');
    }

    return { session, requestId };
  } catch (error) {
    logger.error(
      "Server Action: Erreur lors de la vérification d'authentification",
      {
        error: error.message,
        requestId,
      },
    );

    captureException(error, {
      level: 'error',
      tags: {
        component: 'orders_server_action',
        action: 'auth_check_error',
        error_category: 'authentication',
        execution_context: 'server_action',
      },
      extra: {
        requestId,
        errorMessage: error.message,
        serverAction: 'getFilteredOrders',
        context,
      },
    });

    throw error;
  }
}

/**
 * Server Action pour mettre à jour le statut de paiement d'une commande
 * @param {string} orderId - ID de la commande (UUID)
 * @param {string} newStatus - Nouveau statut de paiement
 * @returns {Promise<Object>} - Résultat de la mise à jour
 */
export async function updateOrderPaymentStatus(orderId, newStatus) {
  let client;
  const startTime = Date.now();
  let requestId;

  try {
    // ===== ÉTAPE 1: AUTHENTIFICATION ET AUTORISATION =====
    const context = {
      userAgent: 'NextJS-ServerAction',
      action: 'updateOrderPaymentStatus',
      timestamp: new Date().toISOString(),
    };

    const { session, requestId: authRequestId } =
      await authenticateServerAction(context);
    requestId = authRequestId;

    logger.info('Server Action: Mise à jour statut commande démarrée', {
      requestId,
      userId: session.user.id,
      orderId,
      newStatus,
    });

    captureMessage('Order status update process started from Server Action', {
      level: 'info',
      tags: {
        component: 'orders_server_action',
        action: 'status_update_start',
        entity: 'order',
        data_type: 'financial',
        execution_context: 'server_action',
      },
      extra: {
        requestId,
        userId: session.user.id,
        orderId,
        newStatus,
        timestamp: new Date().toISOString(),
        method: 'SERVER_ACTION',
      },
    });

    // ===== ÉTAPE 2: VALIDATION DES PARAMÈTRES =====
    if (!orderId || !newStatus) {
      logger.warn(
        'Server Action: Paramètres manquants pour mise à jour commande',
        {
          requestId,
          userId: session.user.id,
          orderId: !!orderId,
          newStatus: !!newStatus,
        },
      );

      throw new Error('Order ID and new status are required');
    }

    // Valider le statut
    const allowedStatuses = ['paid', 'unpaid', 'refunded', 'failed'];
    if (!allowedStatuses.includes(newStatus)) {
      logger.warn('Server Action: Statut de paiement invalide', {
        requestId,
        userId: session.user.id,
        orderId,
        invalidStatus: newStatus,
      });

      throw new Error(`Invalid payment status: ${newStatus}`);
    }

    // Valider l'ID de la commande (doit être un UUID valide)
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!orderId || typeof orderId !== 'string' || !uuidRegex.test(orderId)) {
      logger.warn('Server Action: ID de commande invalide', {
        requestId,
        userId: session.user.id,
        orderId,
      });

      throw new Error(`Invalid order ID: ${orderId}`);
    }

    // ===== ÉTAPE 3: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Server Action: Erreur de connexion base de données', {
        category: errorCategory,
        message: dbConnectionError.message,
        requestId,
        userId: session.user.id,
      });

      captureDatabaseError(dbConnectionError, {
        tags: {
          component: 'orders_server_action',
          action: 'db_connection_failed',
          operation: 'connection',
          entity: 'order',
          data_type: 'financial',
          execution_context: 'server_action',
        },
        extra: {
          requestId,
          userId: session.user.id,
          orderId,
          newStatus,
        },
      });

      throw new Error('Database connection failed for update operation');
    }

    // ===== ÉTAPE 4: VÉRIFICATION DE L'EXISTENCE DE LA COMMANDE =====
    let currentOrder;
    try {
      const checkQuery = `
        SELECT order_id, order_payment_status, order_created, order_price
        FROM admin.orders 
        WHERE order_id = $1
      `;

      const checkResult = await client.query(checkQuery, [orderId]);

      if (checkResult.rows.length === 0) {
        logger.warn('Server Action: Commande non trouvée', {
          requestId,
          userId: session.user.id,
          orderId,
        });

        throw new Error(`Order #${orderId} not found`);
      }

      currentOrder = checkResult.rows[0];
    } catch (queryError) {
      const errorCategory = categorizeError(queryError);

      logger.error(
        'Server Action: Erreur lors de la vérification de la commande',
        {
          category: errorCategory,
          message: queryError.message,
          requestId,
          userId: session.user.id,
          orderId,
        },
      );

      captureDatabaseError(queryError, {
        tags: {
          component: 'orders_server_action',
          action: 'order_check_failed',
          operation: 'SELECT',
          entity: 'order',
          data_type: 'financial',
          execution_context: 'server_action',
        },
        extra: {
          requestId,
          userId: session.user.id,
          orderId,
          postgresCode: queryError.code,
        },
      });

      if (client) await client.cleanup();
      throw new Error('Failed to verify order existence');
    }

    // ===== ÉTAPE 5: MISE À JOUR DU STATUT =====
    try {
      const updateQuery = `
        UPDATE admin.orders 
        SET 
          order_payment_status = $1,
          order_updated = CURRENT_TIMESTAMP
        WHERE order_id = $2
        RETURNING order_id, order_payment_status, order_updated
      `;

      const updateResult = await client.query(updateQuery, [
        newStatus,
        orderId,
      ]);

      if (updateResult.rows.length === 0) {
        logger.error('Server Action: Échec de la mise à jour de la commande', {
          requestId,
          userId: session.user.id,
          orderId,
          newStatus,
        });

        throw new Error('Failed to update order status');
      }

      const updatedOrder = updateResult.rows[0];

      logger.info('Server Action: Statut commande mis à jour avec succès', {
        requestId,
        userId: session.user.id,
        orderId,
        oldStatus: currentOrder.order_payment_status,
        newStatus: updatedOrder.order_payment_status,
      });

      // ===== ÉTAPE 6: INVALIDATION DU CACHE =====
      try {
        invalidateDashboardCache('order', orderId);
      } catch (cacheError) {
        // Non-bloquant
        logger.warn(
          'Server Action: Échec invalidation cache après mise à jour',
          {
            requestId,
            orderId,
            error: cacheError.message,
          },
        );
      }

      // ===== ÉTAPE 7: NETTOYAGE ET LOGGING DE SUCCÈS =====
      const responseTime = Date.now() - startTime;

      captureMessage(
        'Order payment status updated successfully (Server Action)',
        {
          level: 'info',
          tags: {
            component: 'orders_server_action',
            action: 'status_update_success',
            success: 'true',
            entity: 'order',
            data_type: 'financial',
            execution_context: 'server_action',
          },
          extra: {
            requestId,
            userId: session.user.id,
            orderId,
            oldStatus: currentOrder.order_payment_status,
            newStatus: updatedOrder.order_payment_status,
            responseTimeMs: responseTime,
          },
        },
      );

      if (client) await client.cleanup();

      return {
        success: true,
        order: {
          order_id: updatedOrder.order_id,
          order_payment_status: updatedOrder.order_payment_status,
          updated_at: updatedOrder.order_updated,
        },
        oldStatus: currentOrder.order_payment_status,
        newStatus: updatedOrder.order_payment_status,
      };
    } catch (updateError) {
      const errorCategory = categorizeError(updateError);

      logger.error('Server Action: Erreur lors de la mise à jour du statut', {
        category: errorCategory,
        message: updateError.message,
        requestId,
        userId: session.user.id,
        orderId,
        newStatus,
      });

      captureDatabaseError(updateError, {
        tags: {
          component: 'orders_server_action',
          action: 'update_query_failed',
          operation: 'UPDATE',
          entity: 'order',
          data_type: 'financial',
          execution_context: 'server_action',
        },
        extra: {
          requestId,
          userId: session.user.id,
          orderId,
          newStatus,
          oldStatus: currentOrder.order_payment_status,
          postgresCode: updateError.code,
        },
      });

      if (client) await client.cleanup();
      throw new Error('Failed to update order payment status');
    }
  } catch (error) {
    // ===== GESTION GLOBALE DES ERREURS =====
    const errorCategory = categorizeError(error);
    const responseTime = Date.now() - startTime;

    logger.error(
      'Server Action: Erreur globale lors de la mise à jour du statut de commande',
      {
        category: errorCategory,
        response_time_ms: responseTime,
        error_message: error.message,
        requestId: requestId || 'unknown',
        orderId,
        newStatus,
      },
    );

    captureException(error, {
      level: 'error',
      tags: {
        component: 'orders_server_action',
        action: 'global_error_handler_update',
        error_category: errorCategory,
        critical: 'true',
        entity: 'order',
        data_type: 'financial',
        execution_context: 'server_action',
      },
      extra: {
        requestId: requestId || 'unknown',
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'order_status_update_server_action',
        orderId,
        newStatus,
        serverAction: 'updateOrderPaymentStatus',
      },
    });

    if (client) await client.cleanup();

    // En production, ne pas exposer les détails de l'erreur
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'An error occurred while updating the order status. Please try again.',
      );
    } else {
      throw error;
    }
  }
}

/**
 * Server Action pour récupérer les commandes filtrées avec sécurité et performance optimales
 * @param {Object} filters - Filtres à appliquer
 * @returns {Promise<Object>} - Objet contenant les commandes et le total
 */
export async function getFilteredOrders(filters = {}) {
  let client;
  const startTime = Date.now();
  let requestId;

  try {
    // ===== ÉTAPE 1: AUTHENTIFICATION ET AUTORISATION =====
    const context = {
      userAgent: 'NextJS-ServerAction',
      action: 'getFilteredOrders',
      timestamp: new Date().toISOString(),
    };

    const { session, requestId: authRequestId } =
      await authenticateServerAction(context);
    requestId = authRequestId;

    // ===== ÉTAPE 2: RATE LIMITING =====
    const mockRequest = createMockRequest(session);
    const rateLimitResponse = await serverActionRateLimit(mockRequest);

    if (rateLimitResponse) {
      logger.warn('Server Action: Rate limit dépassé', {
        requestId,
        userId: session.user.id,
      });

      throw new Error('Too many requests. Please try again later.');
    }

    logger.info('Server Action: Processus de filtrage des commandes démarré', {
      requestId,
      userId: session.user.id,
      filtersCount: Object.keys(filters).length,
    });

    captureMessage('Orders filtering process started from Server Action', {
      level: 'info',
      tags: {
        component: 'orders_server_action',
        action: 'process_start',
        entity: 'order',
        data_type: 'financial',
        execution_context: 'server_action',
      },
      extra: {
        requestId,
        userId: session.user.id,
        timestamp: new Date().toISOString(),
        method: 'SERVER_ACTION',
        filtersProvided: Object.keys(filters),
      },
    });

    // ===== ÉTAPE 3: VALIDATION ET ASSAINISSEMENT DES FILTRES =====
    const validatedFilters = validateAndSanitizeFilters(filters);

    // ===== ÉTAPE 4: VÉRIFICATION DU CACHE AVEC CLÉ DYNAMIQUE =====
    const cacheKey = generateFilterCacheKey(validatedFilters);

    const cachedOrders = dashboardCache.orders?.get(cacheKey);

    if (cachedOrders) {
      const responseTime = Date.now() - startTime;

      logger.info('Server Action: Commandes servies depuis le cache', {
        orderCount: cachedOrders.orders.length,
        totalCount: cachedOrders.totalOrders,
        response_time_ms: responseTime,
        requestId,
        userId: session.user.id,
      });

      captureMessage(
        'Filtered orders served from cache successfully (Server Action)',
        {
          level: 'info',
          tags: {
            component: 'orders_server_action',
            action: 'cache_hit',
            success: 'true',
            entity: 'order',
            execution_context: 'server_action',
          },
          extra: {
            requestId,
            userId: session.user.id,
            orderCount: cachedOrders.orders.length,
            totalCount: cachedOrders.totalOrders,
            responseTimeMs: responseTime,
            filtersApplied: validatedFilters,
          },
        },
      );

      return cachedOrders;
    }

    // ===== ÉTAPE 5: CONNEXION BASE DE DONNÉES AVEC RETRY =====
    try {
      client = await getClient();
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Server Action: Erreur de connexion base de données', {
        category: errorCategory,
        message: dbConnectionError.message,
        requestId,
        userId: session.user.id,
      });

      captureDatabaseError(dbConnectionError, {
        tags: {
          component: 'orders_server_action',
          action: 'db_connection_failed',
          operation: 'connection',
          entity: 'order',
          data_type: 'financial',
          execution_context: 'server_action',
        },
        extra: {
          requestId,
          userId: session.user.id,
          timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
          filters: validatedFilters,
        },
      });

      throw new Error('Database connection failed for filtering operation');
    }

    // ===== ÉTAPE 6: CONSTRUCTION SÉCURISÉE DE LA REQUÊTE =====
    const { whereClause, values } = buildSecureWhereClause(validatedFilters);

    // ===== ÉTAPE 7: EXÉCUTION DE LA REQUÊTE AVEC TIMEOUT =====
    let ordersResult, countResult;
    const queryStartTime = Date.now();

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
          orders.order_client,
          
          -- Données de l'application
          applications.application_name,
          applications.application_category,
          applications.application_images
          
        FROM admin.orders
        JOIN catalog.applications ON admin.orders.order_application_id = catalog.applications.application_id
        ${whereClause}
        ORDER BY admin.orders.order_created DESC
        LIMIT 1000
      `;

      // Requête pour le total
      const countQuery = `
        SELECT COUNT(*) as total
        FROM admin.orders
        JOIN catalog.applications ON admin.orders.order_application_id = catalog.applications.application_id
        ${whereClause}
      `;

      // Exécution avec timeout intégré
      const queryPromise = Promise.all([
        client.query(mainQuery, values),
        client.query(countQuery, values),
      ]);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Query timeout')), 10000),
      );

      [ordersResult, countResult] = await Promise.race([
        queryPromise,
        timeoutPromise,
      ]);

      const queryTime = Date.now() - queryStartTime;

      // Log des requêtes lentes
      if (queryTime > 2000) {
        logger.warn('Server Action: Requête lente détectée', {
          requestId,
          queryTime_ms: queryTime,
          rowCount: ordersResult.rows.length,
        });
      }
    } catch (queryError) {
      const errorCategory = categorizeError(queryError);

      logger.error("Server Action: Erreur lors de l'exécution de la requête", {
        category: errorCategory,
        message: queryError.message,
        requestId,
        userId: session.user.id,
      });

      captureDatabaseError(queryError, {
        tags: {
          component: 'orders_server_action',
          action: 'query_failed',
          operation: 'SELECT_WITH_JOIN',
          entity: 'order',
          data_type: 'financial',
          execution_context: 'server_action',
        },
        extra: {
          requestId,
          userId: session.user.id,
          table: 'admin.orders',
          queryType: 'orders_filtered_fetch',
          postgresCode: queryError.code,
          filters: validatedFilters,
          parametersCount: values.length,
        },
      });

      if (client) await client.cleanup();
      throw new Error('Database query failed for filtering operation');
    }

    // ===== ÉTAPE 8: VALIDATION ROBUSTE DES DONNÉES =====
    if (!ordersResult || !Array.isArray(ordersResult.rows)) {
      logger.warn(
        'Server Action: Structure de données invalide retournée par la requête',
        {
          requestId,
          resultType: typeof ordersResult,
        },
      );

      captureMessage(
        'Orders query returned invalid data structure (Server Action)',
        {
          level: 'warning',
          tags: {
            component: 'orders_server_action',
            action: 'invalid_data_structure',
            error_category: 'business_logic',
            entity: 'order',
            data_type: 'financial',
            execution_context: 'server_action',
          },
          extra: {
            requestId,
            userId: session.user.id,
            resultType: typeof ordersResult,
            hasRows: !!ordersResult?.rows,
            isArray: Array.isArray(ordersResult?.rows),
            filters: validatedFilters,
          },
        },
      );

      if (client) await client.cleanup();
      throw new Error('Invalid data structure returned from database');
    }

    // ===== ÉTAPE 9: NETTOYAGE ET FORMATAGE SÉCURISÉ DES DONNÉES =====
    const orders = ordersResult.rows;
    const total = parseInt(countResult.rows[0].total);

    // Sanitiser les données sensibles des commandes
    const sanitizedOrders = orders.map((order) => ({
      order_id: order.order_id,
      order_payment_status: ['paid', 'unpaid', 'refunded', 'failed'].includes(
        order.order_payment_status,
      )
        ? order.order_payment_status
        : 'unpaid',
      order_created: order.order_created,
      order_price: Math.max(0, parseFloat(order.order_price) || 0),
      order_application_id: order.order_application_id,
      order_client: Array.isArray(order.order_client)
        ? order.order_client.slice(0, 4) // Limiter à 4 éléments max [nom, prenom, email, phone]
        : [],
      application_name: (order.application_name || '[No Name]').substring(
        0,
        200,
      ),
      application_category: ['mobile', 'web'].includes(
        order.application_category,
      )
        ? order.application_category
        : 'web',
      application_images: Array.isArray(order.application_images)
        ? order.application_images.slice(0, 10) // Limiter à 10 images max
        : [],
    }));

    // ===== ÉTAPE 10: FORMATAGE DE LA RÉPONSE =====
    const response = {
      orders: sanitizedOrders,
      totalOrders: total,
    };

    // ===== ÉTAPE 11: MISE EN CACHE INTELLIGENTE =====
    const cacheSuccess = dashboardCache.orders?.set(cacheKey, response);

    if (!cacheSuccess) {
      logger.warn(
        'Server Action: Échec de la mise en cache des données commandes',
        {
          requestId,
        },
      );
    }

    // ===== ÉTAPE 12: LOGGING DE SUCCÈS ET MÉTRIQUES =====
    const responseTime = Date.now() - startTime;

    logger.info('Server Action: Filtrage commandes terminé avec succès', {
      orderCount: sanitizedOrders.length,
      totalCount: total,
      response_time_ms: responseTime,
      requestId,
      userId: session.user.id,
    });

    captureMessage('Orders filtering completed successfully (Server Action)', {
      level: 'info',
      tags: {
        component: 'orders_server_action',
        action: 'filter_success',
        success: 'true',
        entity: 'order',
        data_type: 'financial',
        execution_context: 'server_action',
      },
      extra: {
        requestId,
        userId: session.user.id,
        orderCount: sanitizedOrders.length,
        totalCount: total,
        responseTimeMs: responseTime,
        queryTimeMs: Date.now() - queryStartTime,
        databaseOperations: cacheSuccess ? 3 : 2,
        cacheMiss: true,
        cacheSet: cacheSuccess,
        filtersApplied: validatedFilters,
      },
    });

    if (client) await client.cleanup();

    return response;
  } catch (error) {
    // ===== GESTION GLOBALE DES ERREURS AVEC CLASSIFICATION =====
    const errorCategory = categorizeError(error);
    const responseTime = Date.now() - startTime;

    logger.error(
      'Server Action: Erreur globale lors du filtrage des commandes',
      {
        category: errorCategory,
        response_time_ms: responseTime,
        error_message: error.message,
        requestId: requestId || 'unknown',
      },
    );

    captureException(error, {
      level: 'error',
      tags: {
        component: 'orders_server_action',
        action: 'global_error_handler',
        error_category: errorCategory,
        critical: 'true',
        entity: 'order',
        data_type: 'financial',
        execution_context: 'server_action',
      },
      extra: {
        requestId: requestId || 'unknown',
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'orders_filter_server_action',
        filtersProvided: filters,
        serverAction: 'getFilteredOrders',
      },
    });

    if (client) await client.cleanup();

    // En production, ne pas exposer les détails de l'erreur
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'An error occurred while filtering orders. Please try again.',
      );
    } else {
      throw error;
    }
  }
}

/**
 * Server Action pour invalider le cache des commandes (pour les opérations CRUD)
 * @param {string|null} orderId - ID spécifique de la commande (optionnel)
 * @returns {Promise<boolean>} - Succès de l'invalidation
 */
export async function invalidateOrdersCache(orderId = null) {
  try {
    const { session, requestId } = await authenticateServerAction();

    logger.info('Server Action: Invalidation du cache commandes demandée', {
      requestId,
      userId: session.user.id,
      orderId,
    });

    const invalidatedCount = invalidateDashboardCache('order', orderId);

    logger.info('Server Action: Cache commandes invalidé avec succès', {
      requestId,
      userId: session.user.id,
      orderId,
      invalidatedCount,
    });

    return true;
  } catch (error) {
    logger.error("Server Action: Erreur lors de l'invalidation du cache", {
      error: error.message,
      orderId,
    });

    return false;
  }
}
