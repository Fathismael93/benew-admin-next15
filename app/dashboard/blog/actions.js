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
  cacheEvents,
} from '@/utils/cache';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@backend/rateLimiter';

// Rate limiting spécifique aux Server Actions
const serverActionRateLimit = applyRateLimit(RATE_LIMIT_PRESETS.CONTENT_API, {
  prefix: 'server_action_blog',
  keyGenerator: (req) => {
    const ip = anonymizeIp(req.ip || '0.0.0.0');
    const sessionId = req.session?.user?.id || 'anonymous';
    return `blog_filter:${sessionId}:${ip}`;
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
    url: '/server-action/getFilteredArticles',
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
  const allowedFields = ['article_title', 'is_active'];
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
      case 'article_title':
        if (typeof value === 'string' && value.trim()) {
          const cleanValue = value.trim().substring(0, maxStringLength);
          const sanitizedValue = cleanValue.replace(/[<>"'%;()&+]/g, '');
          if (sanitizedValue.length >= 2) {
            validatedFilters[key] = sanitizedValue;
          }
        }
        break;

      case 'is_active':
        if (Array.isArray(value)) {
          const allowedValues = ['true', 'false', 'all'];
          const validValues = value
            .filter((v) => typeof v === 'string' && v.trim())
            .map((v) => v.trim())
            .slice(0, maxArrayLength);

          // Si "all" est présent, on ignore ce filtre (pas de condition WHERE)
          const filteredValues = validValues.filter((v) =>
            allowedValues.includes(v),
          );

          // Si "all" est dans les valeurs, on supprime complètement le filtre
          if (!filteredValues.includes('all') && filteredValues.length > 0) {
            validatedFilters[key] = filteredValues.filter((v) => v !== 'all');
          }
          // Si "all" est présent ou aucune valeur valide, on ne met pas le filtre
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

  // Recherche par nom d'article
  if (filters.article_title) {
    conditions.push(`article_title ILIKE $${paramCount}`);
    values.push(`%${filters.article_name}%`);
    paramCount++;
  }

  // Filtre par statut actif (MULTIPLE) avec IN clause sécurisée
  // Note: Si "all" était sélectionné, is_active ne sera pas dans validatedFilters
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

  return getDashboardCacheKey('articles_filtered', {
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
          component: 'blog_server_action',
          action: 'auth_check_failed',
          error_category: 'authentication',
          execution_context: 'server_action',
        },
        extra: {
          requestId,
          timestamp: new Date().toISOString(),
          serverAction: 'getFilteredArticles',
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
        component: 'blog_server_action',
        action: 'auth_check_error',
        error_category: 'authentication',
        execution_context: 'server_action',
      },
      extra: {
        requestId,
        errorMessage: error.message,
        serverAction: 'getFilteredArticles',
        context,
      },
    });

    throw error;
  }
}

/**
 * Server Action pour récupérer les articles filtrés avec sécurité et performance optimales
 * @param {Object} filters - Filtres à appliquer
 * @returns {Promise<Array>} - Liste des articles filtrés
 */
export async function getFilteredArticles(filters = {}) {
  let client;
  const startTime = Date.now();
  let requestId;

  try {
    // ===== ÉTAPE 1: AUTHENTIFICATION ET AUTORISATION =====
    const context = {
      userAgent: 'NextJS-ServerAction',
      action: 'getFilteredArticles',
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

    logger.info('Server Action: Processus de filtrage des articles démarré', {
      requestId,
      userId: session.user.id,
      filtersCount: Object.keys(filters).length,
    });

    captureMessage('Articles filtering process started from Server Action', {
      level: 'info',
      tags: {
        component: 'blog_server_action',
        action: 'process_start',
        entity: 'article',
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

    const cachedArticles = dashboardCache.blogArticles?.get(cacheKey);

    if (cachedArticles) {
      const responseTime = Date.now() - startTime;

      logger.info('Server Action: Articles servis depuis le cache', {
        articleCount: cachedArticles.length,
        response_time_ms: responseTime,
        requestId,
        userId: session.user.id,
      });

      captureMessage(
        'Filtered articles served from cache successfully (Server Action)',
        {
          level: 'info',
          tags: {
            component: 'blog_server_action',
            action: 'cache_hit',
            success: 'true',
            entity: 'article',
            execution_context: 'server_action',
          },
          extra: {
            requestId,
            userId: session.user.id,
            articleCount: cachedArticles.length,
            responseTimeMs: responseTime,
            filtersApplied: validatedFilters,
          },
        },
      );

      // Émettre un événement de cache hit
      cacheEvents.emit('dashboard_hit', {
        key: cacheKey,
        cache: dashboardCache.blogArticles,
        entityType: 'article',
        requestId,
        context: 'server_action',
      });

      return cachedArticles;
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
          component: 'blog_server_action',
          action: 'db_connection_failed',
          operation: 'connection',
          entity: 'article',
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
      const articlesQuery = `
        SELECT
          article_id,
          article_title,
          article_image,
          is_active,
          TO_CHAR(article_created, 'YYYY-MM-DD') AS created,
          TO_CHAR(article_updated, 'YYYY-MM-DD HH24:MI:SS') AS updated
        FROM admin.articles
        ${whereClause}
        ORDER BY article_created DESC, article_id DESC
        LIMIT 1000
      `;

      // Exécution avec timeout intégré
      const queryPromise = client.query(articlesQuery, values);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Query timeout')), 10000),
      );

      result = await Promise.race([queryPromise, timeoutPromise]);

      const queryTime = Date.now() - queryStartTime;

      // Log des requêtes lentes
      if (queryTime > 2000) {
        logger.warn('Server Action: Requête lente détectée', {
          requestId,
          queryTime_ms: queryTime,
          rowCount: result.rows.length,
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
          component: 'blog_server_action',
          action: 'query_failed',
          operation: 'SELECT',
          entity: 'article',
          execution_context: 'server_action',
        },
        extra: {
          requestId,
          userId: session.user.id,
          table: 'admin.articles',
          queryType: 'articles_filtered_fetch',
          postgresCode: queryError.code,
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
          resultType: typeof result,
        },
      );

      captureMessage(
        'Articles query returned invalid data structure (Server Action)',
        {
          level: 'warning',
          tags: {
            component: 'blog_server_action',
            action: 'invalid_data_structure',
            error_category: 'business_logic',
            entity: 'article',
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
    const sanitizedArticles = result.rows.map((article) => ({
      articleId: article.article_id,
      articleTitle: article.article_title || '[No Title]',
      articleImage: article.article_image,
      isActive: Boolean(article.is_active),
      created: article.created,
      updated: article.updated,
    }));

    // ===== ÉTAPE 10: MISE EN CACHE INTELLIGENTE =====
    const cacheSuccess = dashboardCache.blogArticles?.set(
      cacheKey,
      sanitizedArticles,
    );

    if (cacheSuccess) {
      // Émettre un événement de cache set
      cacheEvents.emit('dashboard_set', {
        key: cacheKey,
        cache: dashboardCache.blogArticles,
        entityType: 'article',
        requestId,
        size: sanitizedArticles.length,
        context: 'server_action',
      });
    } else {
      logger.warn(
        'Server Action: Échec de la mise en cache des données articles',
        {
          requestId,
        },
      );
    }

    // ===== ÉTAPE 11: LOGGING DE SUCCÈS ET MÉTRIQUES =====
    const responseTime = Date.now() - startTime;

    logger.info('Server Action: Filtrage articles terminé avec succès', {
      articleCount: sanitizedArticles.length,
      activeArticles: sanitizedArticles.filter((a) => a.isActive).length,
      response_time_ms: responseTime,
      requestId,
      userId: session.user.id,
    });

    captureMessage(
      'Articles filtering completed successfully (Server Action)',
      {
        level: 'info',
        tags: {
          component: 'blog_server_action',
          action: 'filter_success',
          success: 'true',
          entity: 'article',
          execution_context: 'server_action',
        },
        extra: {
          requestId,
          userId: session.user.id,
          articleCount: sanitizedArticles.length,
          activeArticles: sanitizedArticles.filter((a) => a.isActive).length,
          responseTimeMs: responseTime,
          queryTimeMs: Date.now() - queryStartTime,
          databaseOperations: cacheSuccess ? 3 : 2,
          cacheMiss: true,
          cacheSet: cacheSuccess,
          filtersApplied: validatedFilters,
        },
      },
    );

    if (client) await client.cleanup();

    return sanitizedArticles;
  } catch (error) {
    // ===== GESTION GLOBALE DES ERREURS AVEC CLASSIFICATION =====
    const errorCategory = categorizeError(error);
    const responseTime = Date.now() - startTime;

    logger.error(
      'Server Action: Erreur globale lors du filtrage des articles',
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
        component: 'blog_server_action',
        action: 'global_error_handler',
        error_category: errorCategory,
        critical: 'true',
        entity: 'article',
        execution_context: 'server_action',
      },
      extra: {
        requestId: requestId || 'unknown',
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'articles_filter_server_action',
        filtersProvided: filters,
        serverAction: 'getFilteredArticles',
      },
    });

    if (client) await client.cleanup();

    // En production, ne pas exposer les détails de l'erreur
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'An error occurred while filtering articles. Please try again.',
      );
    } else {
      throw error;
    }
  }
}

/**
 * Server Action pour invalider le cache des articles (pour les opérations CRUD)
 * @param {string|null} articleId - ID spécifique de l'article (optionnel)
 * @returns {Promise<boolean>} - Succès de l'invalidation
 */
export async function invalidateArticlesCache(articleId = null) {
  try {
    const { session, requestId } = await authenticateServerAction();

    logger.info('Server Action: Invalidation du cache articles demandée', {
      requestId,
      userId: session.user.id,
      articleId,
    });

    const invalidatedCount = invalidateDashboardCache('article', articleId);

    logger.info('Server Action: Cache articles invalidé avec succès', {
      requestId,
      userId: session.user.id,
      articleId,
      invalidatedCount,
    });

    return true;
  } catch (error) {
    logger.error("Server Action: Erreur lors de l'invalidation du cache", {
      error: error.message,
      articleId,
    });

    return false;
  }
}
