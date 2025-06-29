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
    // Utiliser l'IP + session pour les Server Actions
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
    ip: '127.0.0.1', // IP par défaut pour Server Actions
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
  const allowedFields = ['order_payment_status', 'order_client'];
  const maxStringLength = 100;
  const maxArrayLength = 10;

  for (const [key, value] of Object.entries(filters)) {
    // Vérifier que le champ est autorisé
    if (!allowedFields.includes(key)) {
      logger.warn(
        'Server Action: Tentative de filtrage avec champ non autorisé',
        {
          field: key,
          component: 'orders_server_action',
          action: 'filter_validation_failed',
          security_event: true,
        },
      );
      continue;
    }

    // Validation selon le type de champ
    switch (key) {
      case 'order_client':
        if (typeof value === 'string' && value.trim()) {
          // Nettoyer et limiter la longueur
          const cleanValue = value.trim().substring(0, maxStringLength);
          // Supprimer les caractères potentiellement dangereux
          const sanitizedValue = cleanValue.replace(/[<>"'%;()&+]/g, '');
          if (sanitizedValue.length >= 2) {
            validatedFilters[key] = sanitizedValue;
          }
        }
        break;

      case 'order_payment_status':
        if (Array.isArray(value)) {
          // Valider chaque élément du tableau
          const validValues = value
            .filter((v) => typeof v === 'string' && v.trim())
            .map((v) => v.trim())
            .slice(0, maxArrayLength); // Limiter la taille du tableau

          // Validation spécifique pour les statuts de paiement
          const allowedStatuses = ['paid', 'unpaid', 'refunded', 'failed'];
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

  // Recherche par client (nom et prénom) avec ILIKE sécurisé
  if (filters.order_client) {
    // La recherche se fait sur nom et prénom (order_client[0] et order_client[1])
    conditions.push(`(
      order_client[1] ILIKE $${paramCount} OR 
      order_client[2] ILIKE $${paramCount + 1}
    )`);
    const searchTerm = `%${filters.order_client}%`;
    values.push(searchTerm, searchTerm);
    paramCount += 2;
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
  // Trier les filtres pour garantir la cohérence de la clé
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
    version: '2.0', // Incrémenter lors de changements de schéma
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
        component: 'orders_server_action',
        action: 'auth_check_failed',
        timestamp: new Date().toISOString(),
        context: context.userAgent || 'server_action',
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
        component: 'orders_server_action',
        action: 'invalid_session',
        context,
      });

      throw new Error('Invalid user session');
    }

    logger.debug('Server Action: Authentification utilisateur réussie', {
      userId: session.user.id,
      email: session.user.email?.substring(0, 3) + '***',
      requestId,
      component: 'orders_server_action',
      action: 'auth_verification_success',
      userAgent: context.userAgent,
    });

    return { session, requestId };
  } catch (error) {
    logger.error(
      "Server Action: Erreur lors de la vérification d'authentification",
      {
        error: error.message,
        requestId,
        component: 'orders_server_action',
        action: 'auth_check_error',
        context,
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
      // Rate limit dépassé
      logger.warn('Server Action: Rate limit dépassé', {
        requestId,
        userId: session.user.id,
        component: 'orders_server_action',
        action: 'rate_limit_exceeded',
      });

      throw new Error('Too many requests. Please try again later.');
    }

    logger.debug('Server Action: Rate limiting passé avec succès', {
      requestId,
      userId: session.user.id,
      component: 'orders_server_action',
      action: 'rate_limit_passed',
    });

    logger.info('Server Action: Processus de filtrage des commandes démarré', {
      timestamp: new Date().toISOString(),
      requestId,
      userId: session.user.id,
      component: 'orders_server_action',
      action: 'filter_start',
      method: 'SERVER_ACTION',
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

    logger.debug('Server Action: Filtres validés et nettoyés', {
      requestId,
      component: 'orders_server_action',
      action: 'filters_validated',
      originalFiltersCount: Object.keys(filters).length,
      validatedFiltersCount: Object.keys(validatedFilters).length,
      validatedFilters: validatedFilters,
    });

    // ===== ÉTAPE 4: VÉRIFICATION DU CACHE AVEC CLÉ DYNAMIQUE =====
    const cacheKey = generateFilterCacheKey(validatedFilters);

    logger.debug(
      'Server Action: Vérification du cache pour commandes filtrées',
      {
        requestId,
        component: 'orders_server_action',
        action: 'cache_check_start',
        cacheKey: cacheKey.substring(0, 50) + '...', // Tronquer pour les logs
      },
    );

    const cachedOrders = dashboardCache.orders.get(cacheKey);

    if (cachedOrders) {
      const responseTime = Date.now() - startTime;

      logger.info('Server Action: Commandes servies depuis le cache', {
        orderCount: cachedOrders.orders?.length || 0,
        totalCount: cachedOrders.totalOrders || 0,
        response_time_ms: responseTime,
        cache_hit: true,
        requestId,
        userId: session.user.id,
        component: 'orders_server_action',
        action: 'cache_hit',
        entity: 'order',
        data_type: 'financial',
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
            data_type: 'financial',
            execution_context: 'server_action',
          },
          extra: {
            requestId,
            userId: session.user.id,
            orderCount: cachedOrders.orders?.length || 0,
            totalCount: cachedOrders.totalOrders || 0,
            responseTimeMs: responseTime,
            cacheKey: cacheKey.substring(0, 50),
            filtersApplied: validatedFilters,
          },
        },
      );

      return cachedOrders;
    }

    logger.debug(
      'Server Action: Cache miss, récupération depuis la base de données',
      {
        requestId,
        component: 'orders_server_action',
        action: 'cache_miss',
      },
    );

    // ===== ÉTAPE 5: CONNEXION BASE DE DONNÉES AVEC RETRY =====
    try {
      client = await getClient();
      logger.debug('Server Action: Connexion base de données réussie', {
        requestId,
        component: 'orders_server_action',
        action: 'db_connection_success',
      });
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Server Action: Erreur de connexion base de données', {
        category: errorCategory,
        message: dbConnectionError.message,
        timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
        requestId,
        userId: session.user.id,
        component: 'orders_server_action',
        action: 'db_connection_failed',
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

      logger.debug('Server Action: Exécution de la requête commandes', {
        requestId,
        component: 'orders_server_action',
        action: 'query_start',
        table: 'admin.orders',
        operation: 'SELECT_WITH_JOIN',
        whereConditions: whereClause ? 'WITH_FILTERS' : 'NO_FILTERS',
        parametersCount: values.length,
      });

      // Exécution avec timeout intégré
      const mainQueryPromise = client.query(mainQuery, values);
      const countQueryPromise = client.query(countQuery, values);
      const timeoutPromise = new Promise(
        (_, reject) =>
          setTimeout(() => reject(new Error('Query timeout')), 10000), // 10 secondes
      );

      [ordersResult, countResult] = await Promise.race([
        Promise.all([mainQueryPromise, countQueryPromise]),
        timeoutPromise,
      ]);

      const queryTime = Date.now() - queryStartTime;

      logger.debug('Server Action: Requête commandes exécutée avec succès', {
        requestId,
        component: 'orders_server_action',
        action: 'query_success',
        ordersCount: ordersResult.rows.length,
        totalCount: countResult.rows[0]?.total || 0,
        queryTime_ms: queryTime,
        table: 'admin.orders',
      });

      // Log des requêtes lentes
      if (queryTime > 2000) {
        logger.warn('Server Action: Requête lente détectée', {
          requestId,
          queryTime_ms: queryTime,
          filters: validatedFilters,
          ordersCount: ordersResult.rows.length,
          component: 'orders_server_action',
          action: 'slow_query_detected',
        });
      }
    } catch (queryError) {
      const errorCategory = categorizeError(queryError);
      const queryTime = Date.now() - queryStartTime;

      logger.error("Server Action: Erreur lors de l'exécution de la requête", {
        category: errorCategory,
        message: queryError.message,
        queryTime_ms: queryTime,
        query: 'orders_filtered_fetch',
        table: 'admin.orders',
        parametersCount: values.length,
        requestId,
        userId: session.user.id,
        component: 'orders_server_action',
        action: 'query_failed',
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
          queryTimeMs: queryTime,
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
          component: 'orders_server_action',
          action: 'invalid_data_structure',
          resultType: typeof ordersResult,
          hasRows: !!ordersResult?.rows,
          isArray: Array.isArray(ordersResult?.rows),
          filters: validatedFilters,
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
    const sanitizeStartTime = Date.now();

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

    const sanitizeTime = Date.now() - sanitizeStartTime;

    logger.debug('Server Action: Données commandes nettoyées et formatées', {
      requestId,
      component: 'orders_server_action',
      action: 'data_sanitization',
      originalCount: orders.length,
      sanitizedCount: sanitizedOrders.length,
      sanitizeTime_ms: sanitizeTime,
    });

    // ===== ÉTAPE 10: FORMATAGE DE LA RÉPONSE =====
    const response = {
      orders: sanitizedOrders,
      totalOrders: total,
    };

    // ===== ÉTAPE 11: MISE EN CACHE INTELLIGENTE =====
    const cacheStartTime = Date.now();

    logger.debug(
      'Server Action: Mise en cache des données commandes filtrées',
      {
        requestId,
        component: 'orders_server_action',
        action: 'cache_set_start',
        orderCount: sanitizedOrders.length,
        totalCount: total,
        cacheKey: cacheKey.substring(0, 50),
      },
    );

    const cacheSuccess = dashboardCache.orders.set(cacheKey, response);
    const cacheTime = Date.now() - cacheStartTime;

    if (cacheSuccess) {
      logger.debug(
        'Server Action: Données commandes mises en cache avec succès',
        {
          requestId,
          component: 'orders_server_action',
          action: 'cache_set_success',
          cacheTime_ms: cacheTime,
          cacheKey: cacheKey.substring(0, 50),
        },
      );
    } else {
      logger.warn(
        'Server Action: Échec de la mise en cache des données commandes',
        {
          requestId,
          component: 'orders_server_action',
          action: 'cache_set_failed',
          cacheKey: cacheKey.substring(0, 50),
        },
      );
    }

    // ===== ÉTAPE 12: LOGGING DE SUCCÈS ET MÉTRIQUES =====
    const responseTime = Date.now() - startTime;
    const databaseOperations = cacheSuccess ? 3 : 2; // connection + queries + cache

    logger.info('Server Action: Filtrage commandes terminé avec succès', {
      orderCount: sanitizedOrders.length,
      totalCount: total,
      response_time_ms: responseTime,
      query_time_ms: Date.now() - queryStartTime,
      sanitize_time_ms: sanitizeTime,
      cache_time_ms: cacheTime,
      database_operations: databaseOperations,
      success: true,
      requestId,
      userId: session.user.id,
      component: 'orders_server_action',
      action: 'filter_success',
      entity: 'order',
      data_type: 'financial',
      cacheMiss: true,
      cacheSet: cacheSuccess,
      execution_context: 'server_action',
      filters_applied: validatedFilters,
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
        databaseOperations,
        cacheMiss: true,
        cacheSet: cacheSuccess,
        filtersApplied: validatedFilters,
        performanceMetrics: {
          sanitizeTimeMs: sanitizeTime,
          cacheTimeMs: cacheTime,
        },
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
        reached_global_handler: true,
        error_name: error.name,
        error_message: error.message,
        stack_available: !!error.stack,
        requestId: requestId || 'unknown',
        component: 'orders_server_action',
        action: 'global_error_handler',
        entity: 'order',
        data_type: 'financial',
        execution_context: 'server_action',
        filters: filters,
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
      component: 'orders_server_action',
      action: 'cache_invalidation_start',
    });

    const invalidatedCount = invalidateDashboardCache('order', orderId);

    logger.info('Server Action: Cache commandes invalidé avec succès', {
      requestId,
      userId: session.user.id,
      orderId,
      invalidatedCount,
      component: 'orders_server_action',
      action: 'cache_invalidation_success',
    });

    return true;
  } catch (error) {
    logger.error("Server Action: Erreur lors de l'invalidation du cache", {
      error: error.message,
      orderId,
      component: 'orders_server_action',
      action: 'cache_invalidation_failed',
    });

    return false;
  }
}
