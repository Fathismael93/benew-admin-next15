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
  prefix: 'server_action_applications',
  keyGenerator: (req) => {
    // Utiliser l'IP + session pour les Server Actions
    const ip = anonymizeIp(req.ip || '0.0.0.0');
    const sessionId = req.session?.user?.id || 'anonymous';
    return `applications_filter:${sessionId}:${ip}`;
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
    url: '/server-action/getFilteredApplications',
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
  const allowedFields = ['application_name', 'category', 'level', 'status'];
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
      case 'application_name':
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

      case 'category':
      case 'level':
      case 'status':
        if (Array.isArray(value)) {
          // Valider chaque élément du tableau
          const validValues = value
            .filter((v) => typeof v === 'string' && v.trim())
            .map((v) => v.trim())
            .slice(0, maxArrayLength); // Limiter la taille du tableau

          // Validation spécifique selon le champ
          if (key === 'category') {
            const allowedCategories = ['mobile', 'web'];
            validatedFilters[key] = validValues.filter((v) =>
              allowedCategories.includes(v),
            );
          } else if (key === 'level') {
            const allowedLevels = ['1', '2', '3', '4'];
            validatedFilters[key] = validValues.filter((v) =>
              allowedLevels.includes(v),
            );
          } else if (key === 'status') {
            const allowedStatuses = ['true', 'false'];
            validatedFilters[key] = validValues.filter((v) =>
              allowedStatuses.includes(v),
            );
          }
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

  // Recherche par nom avec ILIKE sécurisé
  if (filters.application_name) {
    conditions.push(`application_name ILIKE $${paramCount}`);
    values.push(`%${filters.application_name}%`);
    paramCount++;
  }

  // Filtre par catégorie (MULTIPLE) avec IN clause sécurisée
  if (filters.category && filters.category.length > 0) {
    const categoryPlaceholders = filters.category
      .map(() => `$${paramCount++}`)
      .join(', ');
    conditions.push(`application_category IN (${categoryPlaceholders})`);
    values.push(...filters.category);
  }

  // Filtre par level (MULTIPLE) avec IN clause sécurisée
  if (filters.level && filters.level.length > 0) {
    const levelPlaceholders = filters.level
      .map(() => `$${paramCount++}`)
      .join(', ');
    conditions.push(`application_level IN (${levelPlaceholders})`);
    values.push(...filters.level);
  }

  // Filtre par status (MULTIPLE) avec IN clause sécurisée
  if (filters.status && filters.status.length > 0) {
    const statusPlaceholders = filters.status
      .map(() => `$${paramCount++}`)
      .join(', ');
    conditions.push(`is_active IN (${statusPlaceholders})`);
    // Conversion sécurisée string vers boolean
    values.push(...filters.status.map((s) => s === 'true'));
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

  return getDashboardCacheKey('applications_filtered', {
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
      });

      captureMessage('Unauthenticated access attempt to Server Action', {
        level: 'warning',
        tags: {
          component: 'applications_server_action',
          action: 'auth_check_failed',
          error_category: 'authentication',
          execution_context: 'server_action',
        },
        extra: {
          requestId,
          serverAction: 'getFilteredApplications',
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
        component: 'applications_server_action',
        action: 'auth_check_error',
        error_category: 'authentication',
        execution_context: 'server_action',
      },
      extra: {
        requestId,
        serverAction: 'getFilteredApplications',
      },
    });

    throw error;
  }
}

/**
 * Server Action pour récupérer les applications filtrées avec sécurité et performance optimales
 * @param {Object} filters - Filtres à appliquer
 * @returns {Promise<Array>} - Liste des applications filtrées
 */
export async function getFilteredApplications(filters = {}) {
  let client;
  const startTime = Date.now();
  let requestId;

  try {
    // ===== ÉTAPE 1: AUTHENTIFICATION ET AUTORISATION =====
    const context = {
      userAgent: 'NextJS-ServerAction',
      action: 'getFilteredApplications',
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
      });

      throw new Error('Too many requests. Please try again later.');
    }

    logger.info(
      'Server Action: Processus de filtrage des applications démarré',
      {
        requestId,
        userId: session.user.id,
        filtersCount: Object.keys(filters).length,
      },
    );

    // ===== ÉTAPE 3: VALIDATION ET ASSAINISSEMENT DES FILTRES =====
    const validatedFilters = validateAndSanitizeFilters(filters);

    // ===== ÉTAPE 4: VÉRIFICATION DU CACHE AVEC CLÉ DYNAMIQUE =====
    const cacheKey = generateFilterCacheKey(validatedFilters);

    const cachedApplications = dashboardCache.applications.get(cacheKey);

    if (cachedApplications) {
      const responseTime = Date.now() - startTime;

      logger.info('Server Action: Applications servies depuis le cache', {
        applicationCount: cachedApplications.length,
        response_time_ms: responseTime,
        requestId,
        userId: session.user.id,
      });

      return cachedApplications;
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
          component: 'applications_server_action',
          action: 'db_connection_failed',
          operation: 'connection',
          entity: 'application',
          execution_context: 'server_action',
        },
        extra: {
          requestId,
          userId: session.user.id,
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
      const applicationsQuery = `
        SELECT 
          application_id, 
          application_name, 
          application_images,
          application_category, 
          application_fee, 
          application_rent, 
          application_link, 
          application_level,
          is_active,
          created_at,
          sales_count,
          updated_at
        FROM catalog.applications
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT 1000
      `;

      // Exécution avec timeout intégré
      const queryPromise = client.query(applicationsQuery, values);
      const timeoutPromise = new Promise(
        (_, reject) =>
          setTimeout(() => reject(new Error('Query timeout')), 10000), // 10 secondes
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
          component: 'applications_server_action',
          action: 'query_failed',
          operation: 'SELECT',
          entity: 'application',
          execution_context: 'server_action',
        },
        extra: {
          requestId,
          userId: session.user.id,
          table: 'catalog.applications',
          queryType: 'applications_filtered_fetch',
          filters: validatedFilters,
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

      if (client) await client.cleanup();
      throw new Error('Invalid data structure returned from database');
    }

    // ===== ÉTAPE 9: NETTOYAGE ET FORMATAGE SÉCURISÉ DES DONNÉES =====
    const sanitizedApplications = result.rows.map((application) => {
      // Validation et nettoyage de chaque champ
      return {
        application_id: parseInt(application.application_id) || 0,
        application_name: (
          application.application_name || '[No Name]'
        ).substring(0, 200),
        application_images: Array.isArray(application.application_images)
          ? application.application_images.slice(0, 10) // Limiter à 10 images max
          : [],
        application_category: ['mobile', 'web'].includes(
          application.application_category,
        )
          ? application.application_category
          : 'web',
        application_fee: Math.max(
          0,
          parseFloat(application.application_fee) || 0,
        ),
        application_rent: Math.max(
          0,
          parseFloat(application.application_rent) || 0,
        ),
        application_link: (application.application_link || '').substring(
          0,
          500,
        ),
        application_level: ['1', '2', '3', '4'].includes(
          application.application_level,
        )
          ? application.application_level
          : '1',
        application_added: application.created_at,
        is_active: Boolean(application.is_active),
        sales_count: Math.max(0, parseInt(application.sales_count) || 0),
        updated_at: application.updated_at,
      };
    });

    // ===== ÉTAPE 10: MISE EN CACHE INTELLIGENTE =====
    const cacheSuccess = dashboardCache.applications.set(
      cacheKey,
      sanitizedApplications,
    );

    // ===== ÉTAPE 11: LOGGING DE SUCCÈS ET MÉTRIQUES =====
    const responseTime = Date.now() - startTime;

    logger.info('Server Action: Filtrage applications terminé avec succès', {
      applicationCount: sanitizedApplications.length,
      response_time_ms: responseTime,
      requestId,
      userId: session.user.id,
    });

    captureMessage(
      'Applications filtering completed successfully (Server Action)',
      {
        level: 'info',
        tags: {
          component: 'applications_server_action',
          action: 'filter_success',
          success: 'true',
          entity: 'application',
          execution_context: 'server_action',
        },
        extra: {
          requestId,
          userId: session.user.id,
          applicationCount: sanitizedApplications.length,
          responseTimeMs: responseTime,
          filtersApplied: validatedFilters,
        },
      },
    );

    if (client) await client.cleanup();

    return sanitizedApplications;
  } catch (error) {
    // ===== GESTION GLOBALE DES ERREURS AVEC CLASSIFICATION =====
    const errorCategory = categorizeError(error);
    const responseTime = Date.now() - startTime;

    logger.error(
      'Server Action: Erreur globale lors du filtrage des applications',
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
        component: 'applications_server_action',
        action: 'global_error_handler',
        error_category: errorCategory,
        critical: 'true',
        entity: 'application',
        execution_context: 'server_action',
      },
      extra: {
        requestId: requestId || 'unknown',
        responseTimeMs: responseTime,
        process: 'applications_filter_server_action',
        filtersProvided: filters,
        serverAction: 'getFilteredApplications',
      },
    });

    if (client) await client.cleanup();

    // En production, ne pas exposer les détails de l'erreur
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'An error occurred while filtering applications. Please try again.',
      );
    } else {
      throw error;
    }
  }
}

/**
 * Server Action pour invalider le cache des applications (pour les opérations CRUD)
 * @param {string|null} applicationId - ID spécifique de l'application (optionnel)
 * @returns {Promise<boolean>} - Succès de l'invalidation
 */
export async function invalidateApplicationsCache(applicationId = null) {
  try {
    const { session, requestId } = await authenticateServerAction();

    logger.info('Server Action: Invalidation du cache applications demandée', {
      requestId,
      userId: session.user.id,
      applicationId,
    });

    const invalidatedCount = invalidateDashboardCache(
      'application',
      applicationId,
    );

    logger.info('Server Action: Cache applications invalidé avec succès', {
      requestId,
      userId: session.user.id,
      applicationId,
      invalidatedCount,
    });

    return true;
  } catch (error) {
    logger.error("Server Action: Erreur lors de l'invalidation du cache", {
      error: error.message,
      applicationId,
    });

    return false;
  }
}
