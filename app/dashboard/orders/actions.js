'use server';

import { getClient } from '@backend/dbConnect';
import { getServerSession } from 'next-auth';
import { auth } from '@app/api/auth/[...nextauth]/route';
import { generateRequestId, categorizeError } from '@/utils/helpers';
import logger from '@/utils/logger';
import {
  captureException,
  captureMessage,
  captureDatabaseError,
} from '@/monitoring/sentry';

/**
 * Validation avancée des filtres avec sécurité renforcée
 * @param {Object} filters - Filtres à valider
 * @returns {Object} - Filtres validés et nettoyés
 */
function validateAndSanitizeFilters(filters = {}) {
  console.log(
    '🔍 [DEBUG] validateAndSanitizeFilters - Input filters:',
    filters,
  );

  const validatedFilters = {};
  const allowedFields = ['order_payment_status', 'order_client'];
  const maxStringLength = 100;
  const maxArrayLength = 10;

  for (const [key, value] of Object.entries(filters)) {
    console.log(`🔍 [DEBUG] Processing filter: ${key} =`, value);

    // Vérifier que le champ est autorisé
    if (!allowedFields.includes(key)) {
      console.log(`❌ [DEBUG] Field ${key} not allowed`);
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
          const cleanValue = value.trim().substring(0, maxStringLength);
          const sanitizedValue = cleanValue.replace(/[<>"'%;()&+]/g, '');
          if (sanitizedValue.length >= 2) {
            validatedFilters[key] = sanitizedValue;
            console.log(`✅ [DEBUG] order_client validated:`, sanitizedValue);
          } else {
            console.log(`❌ [DEBUG] order_client too short:`, sanitizedValue);
          }
        } else {
          console.log(
            `❌ [DEBUG] order_client invalid type or empty:`,
            typeof value,
            value,
          );
        }
        break;

      case 'order_payment_status':
        if (Array.isArray(value)) {
          const validValues = value
            .filter((v) => typeof v === 'string' && v.trim())
            .map((v) => v.trim())
            .slice(0, maxArrayLength);

          const allowedStatuses = ['paid', 'unpaid', 'refunded', 'failed'];
          validatedFilters[key] = validValues.filter((v) =>
            allowedStatuses.includes(v),
          );
          console.log(
            `✅ [DEBUG] order_payment_status validated:`,
            validatedFilters[key],
          );
        } else {
          console.log(
            `❌ [DEBUG] order_payment_status not an array:`,
            typeof value,
            value,
          );
        }
        break;
    }
  }

  console.log(
    '🔍 [DEBUG] validateAndSanitizeFilters - Output:',
    validatedFilters,
  );
  return validatedFilters;
}

/**
 * Construction sécurisée de la clause WHERE avec protection SQL injection
 * @param {Object} filters - Filtres validés
 * @returns {Object} - Objet contenant whereClause et values
 */
function buildSecureWhereClause(filters) {
  console.log('🔍 [DEBUG] buildSecureWhereClause - Input filters:', filters);

  const conditions = [];
  const values = [];
  let paramCount = 1;

  // Recherche par client (nom et prénom) avec ILIKE sécurisé
  if (filters.order_client) {
    console.log('🔍 [DEBUG] Adding order_client filter:', filters.order_client);
    // La recherche se fait sur nom et prénom (order_client[1] et order_client[2])
    conditions.push(`(
      order_client[1] ILIKE $${paramCount} OR 
      order_client[2] ILIKE $${paramCount + 1}
    )`);
    const searchTerm = `%${filters.order_client}%`;
    values.push(searchTerm, searchTerm);
    paramCount += 2;
    console.log(
      '🔍 [DEBUG] Client search condition added, searchTerm:',
      searchTerm,
    );
  }

  // Filtre par statut de paiement (MULTIPLE) avec IN clause sécurisée
  if (filters.order_payment_status && filters.order_payment_status.length > 0) {
    console.log(
      '🔍 [DEBUG] Adding order_payment_status filter:',
      filters.order_payment_status,
    );
    const statusPlaceholders = filters.order_payment_status
      .map(() => `$${paramCount++}`)
      .join(', ');
    conditions.push(`order_payment_status IN (${statusPlaceholders})`);
    values.push(...filters.order_payment_status);
    console.log(
      '🔍 [DEBUG] Status condition added, placeholders:',
      statusPlaceholders,
    );
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  console.log('🔍 [DEBUG] buildSecureWhereClause - Output:');
  console.log('  WHERE clause:', whereClause);
  console.log('  Values:', values);

  return { whereClause, values };
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
  console.log('🚀 [DEBUG] getFilteredOrders called with filters:', filters);

  let client;
  const startTime = Date.now();
  let requestId;

  try {
    // ===== ÉTAPE 1: AUTHENTIFICATION ET AUTORISATION =====
    console.log('🔐 [DEBUG] Starting authentication...');
    const context = {
      userAgent: 'NextJS-ServerAction',
      action: 'getFilteredOrders',
      timestamp: new Date().toISOString(),
    };

    const { session, requestId: authRequestId } =
      await authenticateServerAction(context);
    requestId = authRequestId;
    console.log(
      '✅ [DEBUG] Authentication successful, userId:',
      session.user.id,
    );

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

    // ===== ÉTAPE 2: VALIDATION ET ASSAINISSEMENT DES FILTRES =====
    console.log('🔍 [DEBUG] Validating filters...');
    const validatedFilters = validateAndSanitizeFilters(filters);

    logger.debug('Server Action: Filtres validés et nettoyés', {
      requestId,
      component: 'orders_server_action',
      action: 'filters_validated',
      originalFiltersCount: Object.keys(filters).length,
      validatedFiltersCount: Object.keys(validatedFilters).length,
      validatedFilters: validatedFilters,
    });

    // ===== ÉTAPE 3: CONNEXION BASE DE DONNÉES =====
    console.log('💾 [DEBUG] Connecting to database...');
    try {
      client = await getClient();
      console.log('✅ [DEBUG] Database connection successful');
      logger.debug('Server Action: Connexion base de données réussie', {
        requestId,
        component: 'orders_server_action',
        action: 'db_connection_success',
      });
    } catch (dbConnectionError) {
      console.log(
        '❌ [DEBUG] Database connection failed:',
        dbConnectionError.message,
      );
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

    // ===== ÉTAPE 4: CONSTRUCTION SÉCURISÉE DE LA REQUÊTE =====
    console.log('🔧 [DEBUG] Building WHERE clause...');
    const { whereClause, values } = buildSecureWhereClause(validatedFilters);

    // ===== ÉTAPE 5: EXÉCUTION DE LA REQUÊTE =====
    console.log('📊 [DEBUG] Executing queries...');
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

      console.log('🗃️ [DEBUG] Main query:', mainQuery);
      console.log('🔢 [DEBUG] Count query:', countQuery);
      console.log('📄 [DEBUG] Query values:', values);

      logger.debug('Server Action: Exécution de la requête commandes', {
        requestId,
        component: 'orders_server_action',
        action: 'query_start',
        table: 'admin.orders',
        operation: 'SELECT_WITH_JOIN',
        whereConditions: whereClause ? 'WITH_FILTERS' : 'NO_FILTERS',
        parametersCount: values.length,
      });

      // Exécution des requêtes
      [ordersResult, countResult] = await Promise.all([
        client.query(mainQuery, values),
        client.query(countQuery, values),
      ]);

      const queryTime = Date.now() - queryStartTime;

      console.log('✅ [DEBUG] Queries executed successfully');
      console.log('📊 [DEBUG] Orders found:', ordersResult.rows.length);
      console.log('🔢 [DEBUG] Total count:', countResult.rows[0]?.total || 0);

      logger.debug('Server Action: Requête commandes exécutée avec succès', {
        requestId,
        component: 'orders_server_action',
        action: 'query_success',
        ordersCount: ordersResult.rows.length,
        totalCount: countResult.rows[0]?.total || 0,
        queryTime_ms: queryTime,
        table: 'admin.orders',
      });
    } catch (queryError) {
      console.log('❌ [DEBUG] Query execution failed:', queryError.message);
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

    // ===== ÉTAPE 6: VALIDATION ROBUSTE DES DONNÉES =====
    console.log('🔍 [DEBUG] Validating query results...');
    if (!ordersResult || !Array.isArray(ordersResult.rows)) {
      console.log('❌ [DEBUG] Invalid data structure returned');
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

    // ===== ÉTAPE 7: NETTOYAGE ET FORMATAGE SÉCURISÉ DES DONNÉES =====
    console.log('🧹 [DEBUG] Sanitizing data...');
    const orders = ordersResult.rows;
    const total = parseInt(countResult.rows[0].total);

    console.log('📋 [DEBUG] Sample raw order data:', orders[0]);

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

    console.log('📋 [DEBUG] Sample sanitized order data:', sanitizedOrders[0]);

    logger.debug('Server Action: Données commandes nettoyées et formatées', {
      requestId,
      component: 'orders_server_action',
      action: 'data_sanitization',
      originalCount: orders.length,
      sanitizedCount: sanitizedOrders.length,
    });

    // ===== ÉTAPE 8: FORMATAGE DE LA RÉPONSE =====
    const response = {
      orders: sanitizedOrders,
      totalOrders: total,
    };

    console.log('✅ [DEBUG] Final response:', {
      orderCount: sanitizedOrders.length,
      totalOrders: total,
    });

    // ===== ÉTAPE 9: LOGGING DE SUCCÈS =====
    const responseTime = Date.now() - startTime;

    logger.info('Server Action: Filtrage commandes terminé avec succès', {
      orderCount: sanitizedOrders.length,
      totalCount: total,
      response_time_ms: responseTime,
      success: true,
      requestId,
      userId: session.user.id,
      component: 'orders_server_action',
      action: 'filter_success',
      entity: 'order',
      data_type: 'financial',
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
        filtersApplied: validatedFilters,
      },
    });

    if (client) await client.cleanup();

    return response;
  } catch (error) {
    // ===== GESTION GLOBALE DES ERREURS AVEC CLASSIFICATION =====
    console.log('❌ [DEBUG] Global error in getFilteredOrders:', error.message);
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
