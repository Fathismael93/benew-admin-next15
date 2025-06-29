import ApplicationsList from '@/ui/pages/applications/ApplicationsList';
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
 * Fonction pour récupérer les applications depuis la base de données
 * Cette fonction remplace l'appel API et s'exécute directement côté serveur
 * @returns {Promise<Array>} Liste des applications ou tableau vide en cas d'erreur
 */
async function getApplicationsFromDatabase(filters = {}) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();

  logger.info('Applications fetch process started (Server Component)', {
    timestamp: new Date().toISOString(),
    requestId,
    component: 'applications_server_component',
    action: 'fetch_start',
    method: 'SERVER_COMPONENT',
  });

  // Capturer le début du processus de récupération des applications
  captureMessage('Applications fetch process started from Server Component', {
    level: 'info',
    tags: {
      component: 'applications_server_component',
      action: 'process_start',
      entity: 'application',
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
    const cacheKey = getDashboardCacheKey('applications_list', {
      endpoint: 'server_component_applications',
      version: '1.0',
    });

    logger.debug('Checking cache for applications (Server Component)', {
      requestId,
      component: 'applications_server_component',
      action: 'cache_check_start',
      cacheKey,
    });

    // Vérifier si les données sont en cache
    const cachedApplications = dashboardCache.applications.get(cacheKey);

    if (cachedApplications) {
      const responseTime = Date.now() - startTime;

      logger.info('Applications served from cache (Server Component)', {
        applicationCount: cachedApplications.length,
        response_time_ms: responseTime,
        cache_hit: true,
        requestId,
        component: 'applications_server_component',
        action: 'cache_hit',
        entity: 'application',
      });

      // Capturer le succès du cache avec Sentry
      captureMessage(
        'Applications served from cache successfully (Server Component)',
        {
          level: 'info',
          tags: {
            component: 'applications_server_component',
            action: 'cache_hit',
            success: 'true',
            entity: 'application',
            execution_context: 'server_component',
          },
          extra: {
            requestId,
            applicationCount: cachedApplications.length,
            responseTimeMs: responseTime,
            cacheKey,
          },
        },
      );

      return cachedApplications;
    }

    logger.debug('Cache miss, fetching from database (Server Component)', {
      requestId,
      component: 'applications_server_component',
      action: 'cache_miss',
    });

    // ===== ÉTAPE 2: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
      logger.debug('Database connection successful (Server Component)', {
        requestId,
        component: 'applications_server_component',
        action: 'db_connection_success',
      });
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error(
        'Database Connection Error during applications fetch (Server Component)',
        {
          category: errorCategory,
          message: dbConnectionError.message,
          timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
          requestId,
          component: 'applications_server_component',
          action: 'db_connection_failed',
        },
      );

      // Capturer l'erreur de connexion DB avec Sentry
      captureDatabaseError(dbConnectionError, {
        tags: {
          component: 'applications_server_component',
          action: 'db_connection_failed',
          operation: 'connection',
          entity: 'application',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
        },
      });

      // Retourner un tableau vide plutôt que de faire planter la page
      return [];
    }

    // Construction dynamique de la clause WHERE
    const conditions = [];
    const values = [];
    let paramCount = 1;

    if (filters.application_name) {
      conditions.push(`application_name ILIKE $${paramCount}`);
      values.push(`%${filters.name}%`);
      paramCount++;
    }

    if (filters.category) {
      conditions.push(`application_category = $${paramCount}`);
      values.push(`%${filters.name}%`);
      paramCount++;
    }

    if (filters.level) {
      conditions.push(`application_level = $${paramCount}`);
      values.push(filters.level);
      paramCount++;
    }

    if (filters.status !== undefined) {
      conditions.push(`is_active = $${paramCount}`);
      values.push(filters.active === 'true');
      paramCount++;
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // ===== ÉTAPE 3: EXÉCUTION DE LA REQUÊTE =====
    let result;
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
      `;

      logger.debug('Executing applications query (Server Component)', {
        requestId,
        component: 'applications_server_component',
        action: 'query_start',
        table: 'catalog.applications',
        operation: 'SELECT',
      });

      result = await client.query(applicationsQuery, values);

      logger.debug(
        'Applications query executed successfully (Server Component)',
        {
          requestId,
          component: 'applications_server_component',
          action: 'query_success',
          rowCount: result.rows.length,
          table: 'catalog.applications',
        },
      );
    } catch (queryError) {
      const errorCategory = categorizeError(queryError);

      logger.error('Applications Query Error (Server Component)', {
        category: errorCategory,
        message: queryError.message,
        query: 'applications_fetch',
        table: 'catalog.applications',
        requestId,
        component: 'applications_server_component',
        action: 'query_failed',
      });

      // Capturer l'erreur de requête avec Sentry
      captureDatabaseError(queryError, {
        tags: {
          component: 'applications_server_component',
          action: 'query_failed',
          operation: 'SELECT',
          entity: 'application',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          table: 'catalog.applications',
          queryType: 'applications_fetch',
          postgresCode: queryError.code,
          postgresDetail: queryError.detail ? '[Filtered]' : undefined,
        },
      });

      if (client) await client.cleanup();
      return []; // Retourner un tableau vide plutôt que de faire planter la page
    }

    // ===== ÉTAPE 4: VALIDATION DES DONNÉES =====
    if (!result || !Array.isArray(result.rows)) {
      logger.warn(
        'Applications query returned invalid data structure (Server Component)',
        {
          requestId,
          component: 'applications_server_component',
          action: 'invalid_data_structure',
          resultType: typeof result,
          hasRows: !!result?.rows,
          isArray: Array.isArray(result?.rows),
        },
      );

      captureMessage(
        'Applications query returned invalid data structure (Server Component)',
        {
          level: 'warning',
          tags: {
            component: 'applications_server_component',
            action: 'invalid_data_structure',
            error_category: 'business_logic',
            entity: 'application',
            execution_context: 'server_component',
          },
          extra: {
            requestId,
            resultType: typeof result,
            hasRows: !!result?.rows,
            isArray: Array.isArray(result?.rows),
          },
        },
      );

      if (client) await client.cleanup();
      return []; // Retourner un tableau vide plutôt que de faire planter la page
    }

    // ===== ÉTAPE 5: NETTOYAGE ET FORMATAGE DES DONNÉES =====
    const sanitizedApplications = result.rows.map((application) => ({
      application_id: application.application_id,
      application_name: application.application_name || '[No Name]',
      application_images: application.application_images,
      application_category: application.application_category || 'web',
      application_fee: parseFloat(application.application_fee) || 0,
      application_rent: parseFloat(application.application_rent) || 0,
      application_link: application.application_link,
      application_level: application.application_level || '1',
      application_added: application.created_at,
      is_active: Boolean(application.is_active),
      sales_count: parseInt(application.sales_count) || 0,
      updated_at: application.updated_at,
    }));

    logger.debug('Applications data sanitized (Server Component)', {
      requestId,
      component: 'applications_server_component',
      action: 'data_sanitization',
      originalCount: result.rows.length,
      sanitizedCount: sanitizedApplications.length,
    });

    // ===== ÉTAPE 6: MISE EN CACHE DES DONNÉES =====
    logger.debug('Caching applications data (Server Component)', {
      requestId,
      component: 'applications_server_component',
      action: 'cache_set_start',
      applicationCount: sanitizedApplications.length,
    });

    // Mettre les données en cache
    const cacheSuccess = dashboardCache.applications.set(
      cacheKey,
      sanitizedApplications,
    );

    if (cacheSuccess) {
      logger.debug('Applications data cached successfully (Server Component)', {
        requestId,
        component: 'applications_server_component',
        action: 'cache_set_success',
        cacheKey,
      });
    } else {
      logger.warn('Failed to cache applications data (Server Component)', {
        requestId,
        component: 'applications_server_component',
        action: 'cache_set_failed',
        cacheKey,
      });
    }

    // ===== ÉTAPE 7: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Applications fetch successful (Server Component)', {
      applicationCount: sanitizedApplications.length,
      response_time_ms: responseTime,
      database_operations: 2, // connection + query
      success: true,
      requestId,
      component: 'applications_server_component',
      action: 'fetch_success',
      entity: 'application',
      cacheMiss: true,
      cacheSet: cacheSuccess,
      execution_context: 'server_component',
    });

    // Capturer le succès de la récupération avec Sentry
    captureMessage(
      'Applications fetch completed successfully (Server Component)',
      {
        level: 'info',
        tags: {
          component: 'applications_server_component',
          action: 'fetch_success',
          success: 'true',
          entity: 'application',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          applicationCount: sanitizedApplications.length,
          responseTimeMs: responseTime,
          databaseOperations: 2,
          cacheMiss: true,
          cacheSet: cacheSuccess,
        },
      },
    );

    if (client) await client.cleanup();

    return sanitizedApplications;
  } catch (error) {
    // ===== GESTION GLOBALE DES ERREURS =====
    const errorCategory = categorizeError(error);
    const responseTime = Date.now() - startTime;

    logger.error('Global Applications Error (Server Component)', {
      category: errorCategory,
      response_time_ms: responseTime,
      reached_global_handler: true,
      error_name: error.name,
      error_message: error.message,
      stack_available: !!error.stack,
      requestId,
      component: 'applications_server_component',
      action: 'global_error_handler',
      entity: 'application',
      execution_context: 'server_component',
    });

    // Capturer l'erreur globale avec Sentry
    captureException(error, {
      level: 'error',
      tags: {
        component: 'applications_server_component',
        action: 'global_error_handler',
        error_category: errorCategory,
        critical: 'true',
        entity: 'application',
        execution_context: 'server_component',
      },
      extra: {
        requestId,
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'applications_fetch_server_component',
      },
    });

    if (client) await client.cleanup();

    // En cas d'erreur grave, retourner un tableau vide pour éviter de casser la page
    // L'utilisateur verra une liste vide mais la page se chargera
    return [];
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
      logger.warn('Unauthenticated access attempt to applications page', {
        component: 'applications_server_component',
        action: 'auth_check_failed',
        timestamp: new Date().toISOString(),
      });

      // Capturer la tentative d'accès non authentifiée
      captureMessage('Unauthenticated access attempt to applications page', {
        level: 'warning',
        tags: {
          component: 'applications_server_component',
          action: 'auth_check_failed',
          error_category: 'authentication',
        },
        extra: {
          timestamp: new Date().toISOString(),
          page: 'applications',
        },
      });

      return null;
    }

    logger.debug(
      'User authentication verified successfully (Server Component)',
      {
        userId: session.user?.id,
        email: session.user?.email?.substring(0, 3) + '***',
        component: 'applications_server_component',
        action: 'auth_verification_success',
      },
    );

    return session;
  } catch (error) {
    logger.error('Authentication check error (Server Component)', {
      error: error.message,
      component: 'applications_server_component',
      action: 'auth_check_error',
    });

    captureException(error, {
      level: 'error',
      tags: {
        component: 'applications_server_component',
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
 * Server Component principal pour la page des applications
 * Cette fonction s'exécute côté serveur et remplace l'appel API
 */
const ApplicationsPage = async ({ searchParams }) => {
  try {
    // ===== ÉTAPE 1: VÉRIFICATION AUTHENTIFICATION =====
    const session = await checkAuthentication();

    if (!session) {
      // Rediriger vers la page de login si non authentifié
      redirect('/login');
    }

    // ===== ÉTAPE 2: RÉCUPÉRATION DES APPLICATIONS =====
    const applications = await getApplicationsFromDatabase(searchParams);

    // ===== ÉTAPE 3: RENDU DE LA PAGE =====
    logger.info('Applications page rendering (Server Component)', {
      applicationCount: applications.length,
      userId: session.user?.id,
      component: 'applications_server_component',
      action: 'page_render',
      timestamp: new Date().toISOString(),
    });

    return <ApplicationsList data={applications} searchParams={searchParams} />;
  } catch (error) {
    // Gestion des erreurs au niveau de la page
    logger.error('Applications page error (Server Component)', {
      error: error.message,
      stack: error.stack,
      component: 'applications_server_component',
      action: 'page_error',
    });

    captureException(error, {
      level: 'error',
      tags: {
        component: 'applications_server_component',
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
    return <ApplicationsList data={[]} searchParams={searchParams} />;
  }
};

export default ApplicationsPage;
