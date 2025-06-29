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
  prefix: 'server_action_templates',
  keyGenerator: (req) => {
    const ip = anonymizeIp(req.ip || '0.0.0.0');
    const sessionId = req.session?.user?.id || 'anonymous';
    return `templates_filter:${sessionId}:${ip}`;
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
    url: '/server-action/getFilteredTemplates',
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
  const allowedFields = [
    'template_name',
    'template_has_mobile',
    'template_has_web',
    'is_active',
  ];
  const maxStringLength = 100;
  const maxArrayLength = 10;

  for (const [key, value] of Object.entries(filters)) {
    // Vérifier que le champ est autorisé
    if (!allowedFields.includes(key)) {
      logger.warn(
        'Server Action: Tentative de filtrage avec champ non autorisé',
        {
          field: key,
          component: 'templates_server_action',
          action: 'filter_validation_failed',
          security_event: true,
        },
      );
      continue;
    }

    // Validation selon le type de champ
    switch (key) {
      case 'template_name':
        if (typeof value === 'string' && value.trim()) {
          const cleanValue = value.trim().substring(0, maxStringLength);
          const sanitizedValue = cleanValue.replace(/[<>"'%;()&+]/g, '');
          if (sanitizedValue.length >= 2) {
            validatedFilters[key] = sanitizedValue;
          }
        }
        break;

      case 'template_has_mobile':
      case 'template_has_web':
      case 'is_active':
        if (Array.isArray(value)) {
          const allowedValues = ['true', 'false'];
          const validValues = value
            .filter((v) => typeof v === 'string' && v.trim())
            .map((v) => v.trim())
            .slice(0, maxArrayLength);
          validatedFilters[key] = validValues.filter((v) =>
            allowedValues.includes(v),
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

  // Recherche par nom de template
  if (filters.template_name) {
    conditions.push(`template_name ILIKE $${paramCount}`);
    values.push(`%${filters.template_name}%`);
    paramCount++;
  }

  // Filtre par support mobile (MULTIPLE) avec IN clause sécurisée
  if (filters.template_has_mobile && filters.template_has_mobile.length > 0) {
    const mobilePlaceholders = filters.template_has_mobile
      .map(() => `$${paramCount++}`)
      .join(', ');
    conditions.push(`template_has_mobile IN (${mobilePlaceholders})`);
    values.push(...filters.template_has_mobile.map((val) => val === 'true'));
  }

  // Filtre par support web (MULTIPLE) avec IN clause sécurisée
  if (filters.template_has_web && filters.template_has_web.length > 0) {
    const webPlaceholders = filters.template_has_web
      .map(() => `$${paramCount++}`)
      .join(', ');
    conditions.push(`template_has_web IN (${webPlaceholders})`);
    values.push(...filters.template_has_web.map((val) => val === 'true'));
  }

  // Filtre par statut actif (MULTIPLE) avec IN clause sécurisée
  if (filters.is_active && filters.is_active.length > 0) {
    const activePlaceholders = filters.is_active
      .map(() => `$${paramCount++}`)
      .join(', ');
    conditions.push(`is_active IN (${activePlaceholders})`);
    values.push(...filters.is_active.map((val) => val === 'true'));
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

  return getDashboardCacheKey('templates_filtered', {
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
        component: 'templates_server_action',
        action: 'auth_check_failed',
        timestamp: new Date().toISOString(),
        context: context.userAgent || 'server_action',
      });

      captureMessage('Unauthenticated access attempt to Server Action', {
        level: 'warning',
        tags: {
          component: 'templates_server_action',
          action: 'auth_check_failed',
          error_category: 'authentication',
          execution_context: 'server_action',
        },
        extra: {
          requestId,
          timestamp: new Date().toISOString(),
          serverAction: 'getFilteredTemplates',
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
        component: 'templates_server_action',
        action: 'invalid_session',
        context,
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
        component: 'templates_server_action',
        action: 'auth_check_error',
        context,
      },
    );

    captureException(error, {
      level: 'error',
      tags: {
        component: 'templates_server_action',
        action: 'auth_check_error',
        error_category: 'authentication',
        execution_context: 'server_action',
      },
      extra: {
        requestId,
        errorMessage: error.message,
        serverAction: 'getFilteredTemplates',
        context,
      },
    });

    throw error;
  }
}

/**
 * Server Action pour récupérer les templates filtrés avec sécurité et performance optimales
 * @param {Object} filters - Filtres à appliquer
 * @returns {Promise<Array>} - Liste des templates filtrés
 */
export async function getFilteredTemplates(filters = {}) {
  let client;
  const startTime = Date.now();
  let requestId;

  try {
    // ===== ÉTAPE 1: AUTHENTIFICATION ET AUTORISATION =====
    const context = {
      userAgent: 'NextJS-ServerAction',
      action: 'getFilteredTemplates',
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
        component: 'templates_server_action',
        action: 'rate_limit_exceeded',
      });

      throw new Error('Too many requests. Please try again later.');
    }

    logger.info('Server Action: Processus de filtrage des templates démarré', {
      timestamp: new Date().toISOString(),
      requestId,
      userId: session.user.id,
      component: 'templates_server_action',
      action: 'filter_start',
      method: 'SERVER_ACTION',
      filtersCount: Object.keys(filters).length,
    });

    captureMessage('Templates filtering process started from Server Action', {
      level: 'info',
      tags: {
        component: 'templates_server_action',
        action: 'process_start',
        entity: 'template',
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
      component: 'templates_server_action',
      action: 'filters_validated',
      originalFiltersCount: Object.keys(filters).length,
      validatedFiltersCount: Object.keys(validatedFilters).length,
      validatedFilters: validatedFilters,
    });

    // ===== ÉTAPE 4: VÉRIFICATION DU CACHE AVEC CLÉ DYNAMIQUE =====
    const cacheKey = generateFilterCacheKey(validatedFilters);

    const cachedTemplates = dashboardCache.templates?.get(cacheKey);

    if (cachedTemplates) {
      const responseTime = Date.now() - startTime;

      logger.info('Server Action: Templates servis depuis le cache', {
        templateCount: cachedTemplates.length,
        response_time_ms: responseTime,
        cache_hit: true,
        requestId,
        userId: session.user.id,
        component: 'templates_server_action',
        action: 'cache_hit',
        entity: 'template',
      });

      captureMessage(
        'Filtered templates served from cache successfully (Server Action)',
        {
          level: 'info',
          tags: {
            component: 'templates_server_action',
            action: 'cache_hit',
            success: 'true',
            entity: 'template',
            execution_context: 'server_action',
          },
          extra: {
            requestId,
            userId: session.user.id,
            templateCount: cachedTemplates.length,
            responseTimeMs: responseTime,
            filtersApplied: validatedFilters,
          },
        },
      );

      return cachedTemplates;
    }

    // ===== ÉTAPE 5: CONNEXION BASE DE DONNÉES AVEC RETRY =====
    try {
      client = await getClient();
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Server Action: Erreur de connexion base de données', {
        category: errorCategory,
        message: dbConnectionError.message,
        timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
        requestId,
        userId: session.user.id,
        component: 'templates_server_action',
        action: 'db_connection_failed',
      });

      captureDatabaseError(dbConnectionError, {
        tags: {
          component: 'templates_server_action',
          action: 'db_connection_failed',
          operation: 'connection',
          entity: 'template',
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
    let result;
    const queryStartTime = Date.now();

    try {
      const templatesQuery = `
        SELECT 
          template_id, 
          template_name, 
          template_image, 
          template_has_web, 
          template_has_mobile, 
          template_added, 
          sales_count, 
          is_active, 
          updated_at 
        FROM catalog.templates
        ${whereClause}
        ORDER BY template_added DESC
        LIMIT 1000
      `;

      logger.debug('Server Action: Exécution de la requête templates', {
        requestId,
        component: 'templates_server_action',
        action: 'query_start',
        table: 'catalog.templates',
        operation: 'SELECT',
        whereConditions: whereClause ? 'WITH_FILTERS' : 'NO_FILTERS',
        parametersCount: values.length,
      });

      // Exécution avec timeout intégré
      const queryPromise = client.query(templatesQuery, values);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Query timeout')), 10000),
      );

      result = await Promise.race([queryPromise, timeoutPromise]);

      const queryTime = Date.now() - queryStartTime;

      logger.debug('Server Action: Requête templates exécutée avec succès', {
        requestId,
        component: 'templates_server_action',
        action: 'query_success',
        rowCount: result.rows.length,
        queryTime_ms: queryTime,
        table: 'catalog.templates',
      });

      // Log des requêtes lentes
      if (queryTime > 2000) {
        logger.warn('Server Action: Requête lente détectée', {
          requestId,
          queryTime_ms: queryTime,
          filters: validatedFilters,
          rowCount: result.rows.length,
          component: 'templates_server_action',
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
        query: 'templates_filtered_fetch',
        table: 'catalog.templates',
        parametersCount: values.length,
        requestId,
        userId: session.user.id,
        component: 'templates_server_action',
        action: 'query_failed',
      });

      captureDatabaseError(queryError, {
        tags: {
          component: 'templates_server_action',
          action: 'query_failed',
          operation: 'SELECT',
          entity: 'template',
          execution_context: 'server_action',
        },
        extra: {
          requestId,
          userId: session.user.id,
          table: 'catalog.templates',
          queryType: 'templates_filtered_fetch',
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
    if (!result || !Array.isArray(result.rows)) {
      logger.warn(
        'Server Action: Structure de données invalide retournée par la requête',
        {
          requestId,
          component: 'templates_server_action',
          action: 'invalid_data_structure',
          resultType: typeof result,
          hasRows: !!result?.rows,
          isArray: Array.isArray(result?.rows),
          filters: validatedFilters,
        },
      );

      captureMessage(
        'Templates query returned invalid data structure (Server Action)',
        {
          level: 'warning',
          tags: {
            component: 'templates_server_action',
            action: 'invalid_data_structure',
            error_category: 'business_logic',
            entity: 'template',
            execution_context: 'server_action',
          },
          extra: {
            requestId,
            userId: session.user.id,
            resultType: typeof result,
            hasRows: !!result?.rows,
            isArray: Array.isArray(result?.rows),
            filters: validatedFilters,
          },
        },
      );

      if (client) await client.cleanup();
      throw new Error('Invalid data structure returned from database');
    }

    // ===== ÉTAPE 9: NETTOYAGE ET FORMATAGE SÉCURISÉ DES DONNÉES =====
    const sanitizeStartTime = Date.now();

    const sanitizedTemplates = result.rows.map((template) => ({
      template_id: template.template_id,
      template_name: template.template_name || '[No Name]',
      template_image: template.template_image,
      template_has_web: Boolean(template.template_has_web),
      template_has_mobile: Boolean(template.template_has_mobile),
      template_added: template.template_added,
      sales_count: Math.max(0, parseInt(template.sales_count) || 0),
      is_active: Boolean(template.is_active),
      updated_at: template.updated_at,
    }));

    const sanitizeTime = Date.now() - sanitizeStartTime;

    logger.debug('Server Action: Données templates nettoyées et formatées', {
      requestId,
      component: 'templates_server_action',
      action: 'data_sanitization',
      originalCount: result.rows.length,
      sanitizedCount: sanitizedTemplates.length,
      sanitizeTime_ms: sanitizeTime,
    });

    // ===== ÉTAPE 10: MISE EN CACHE INTELLIGENTE =====
    const cacheStartTime = Date.now();

    const cacheSuccess = dashboardCache.templates?.set(
      cacheKey,
      sanitizedTemplates,
    );
    const cacheTime = Date.now() - cacheStartTime;

    if (cacheSuccess) {
      logger.debug(
        'Server Action: Données templates mises en cache avec succès',
        {
          requestId,
          component: 'templates_server_action',
          action: 'cache_set_success',
          cacheTime_ms: cacheTime,
          cacheKey: cacheKey.substring(0, 50),
        },
      );
    } else {
      logger.warn(
        'Server Action: Échec de la mise en cache des données templates',
        {
          requestId,
          component: 'templates_server_action',
          action: 'cache_set_failed',
          cacheKey: cacheKey.substring(0, 50),
        },
      );
    }

    // ===== ÉTAPE 11: LOGGING DE SUCCÈS ET MÉTRIQUES =====
    const responseTime = Date.now() - startTime;
    const databaseOperations = cacheSuccess ? 3 : 2; // connection + query + cache

    logger.info('Server Action: Filtrage templates terminé avec succès', {
      templateCount: sanitizedTemplates.length,
      response_time_ms: responseTime,
      query_time_ms: Date.now() - queryStartTime,
      sanitize_time_ms: sanitizeTime,
      cache_time_ms: cacheTime,
      database_operations: databaseOperations,
      success: true,
      requestId,
      userId: session.user.id,
      component: 'templates_server_action',
      action: 'filter_success',
      entity: 'template',
      cacheMiss: true,
      cacheSet: cacheSuccess,
      execution_context: 'server_action',
      filters_applied: validatedFilters,
    });

    captureMessage(
      'Templates filtering completed successfully (Server Action)',
      {
        level: 'info',
        tags: {
          component: 'templates_server_action',
          action: 'filter_success',
          success: 'true',
          entity: 'template',
          execution_context: 'server_action',
        },
        extra: {
          requestId,
          userId: session.user.id,
          templateCount: sanitizedTemplates.length,
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
      },
    );

    if (client) await client.cleanup();

    return sanitizedTemplates;
  } catch (error) {
    // ===== GESTION GLOBALE DES ERREURS AVEC CLASSIFICATION =====
    const errorCategory = categorizeError(error);
    const responseTime = Date.now() - startTime;

    logger.error(
      'Server Action: Erreur globale lors du filtrage des templates',
      {
        category: errorCategory,
        response_time_ms: responseTime,
        reached_global_handler: true,
        error_name: error.name,
        error_message: error.message,
        stack_available: !!error.stack,
        requestId: requestId || 'unknown',
        component: 'templates_server_action',
        action: 'global_error_handler',
        entity: 'template',
        execution_context: 'server_action',
        filters: filters,
      },
    );

    captureException(error, {
      level: 'error',
      tags: {
        component: 'templates_server_action',
        action: 'global_error_handler',
        error_category: errorCategory,
        critical: 'true',
        entity: 'template',
        execution_context: 'server_action',
      },
      extra: {
        requestId: requestId || 'unknown',
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'templates_filter_server_action',
        filtersProvided: filters,
        serverAction: 'getFilteredTemplates',
      },
    });

    if (client) await client.cleanup();

    // En production, ne pas exposer les détails de l'erreur
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'An error occurred while filtering templates. Please try again.',
      );
    } else {
      throw error;
    }
  }
}

/**
 * Server Action pour invalider le cache des templates (pour les opérations CRUD)
 * @param {string|null} templateId - ID spécifique du template (optionnel)
 * @returns {Promise<boolean>} - Succès de l'invalidation
 */
export async function invalidateTemplatesCache(templateId = null) {
  try {
    const { session, requestId } = await authenticateServerAction();

    logger.info('Server Action: Invalidation du cache templates demandée', {
      requestId,
      userId: session.user.id,
      templateId,
      component: 'templates_server_action',
      action: 'cache_invalidation_start',
    });

    const invalidatedCount = invalidateDashboardCache('template', templateId);

    logger.info('Server Action: Cache templates invalidé avec succès', {
      requestId,
      userId: session.user.id,
      templateId,
      invalidatedCount,
      component: 'templates_server_action',
      action: 'cache_invalidation_success',
    });

    return true;
  } catch (error) {
    logger.error("Server Action: Erreur lors de l'invalidation du cache", {
      error: error.message,
      templateId,
      component: 'templates_server_action',
      action: 'cache_invalidation_failed',
    });

    return false;
  }
}
