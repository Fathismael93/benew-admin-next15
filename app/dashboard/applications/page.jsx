// app/dashboard/applications/page.jsx
// Exemple d'utilisation de la nouvelle architecture Sentry dans un Server Component

import ApplicationsList from '@/ui/pages/applications/ApplicationsList';
import { getServerSession } from 'next-auth';
import { auth } from '@app/api/auth/[...nextauth]/route';
import { getClient } from '@backend/dbConnect';
import { redirect, notFound } from 'next/navigation';

// ✅ NOUVEAU: Import des fonctions Sentry adaptées pour Server Components
import {
  captureException,
  captureMessage,
  captureDatabaseError,
  captureServerComponentError,
  withServerComponentMonitoring,
} from '@/monitoring/sentry';

// ✅ NOUVEAU: Import safe des helpers (pas de problème de browser globals)
import { categorizeError, generateRequestId } from '@/utils/helpers';

import logger from '@/utils/logger';
import { dashboardCache, getDashboardCacheKey } from '@/utils/cache';

// Configuration de revalidation pour cette page
export const revalidate = 0;
export const dynamic = 'force-dynamic';

/**
 * Fonction pour récupérer les applications depuis la base de données
 * ✅ MISE À JOUR: Utilise la nouvelle architecture Sentry
 */
async function getApplicationsFromDatabase() {
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

  // ✅ NOUVEAU: Utilisation des fonctions Sentry adaptées
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

      // ✅ NOUVEAU: captureMessage adapté pour Server Components
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

      // ✅ NOUVEAU: captureDatabaseError adapté pour Server Components
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

      return [];
    }

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
        ORDER BY created_at DESC
      `;

      logger.debug('Executing applications query (Server Component)', {
        requestId,
        component: 'applications_server_component',
        action: 'query_start',
        table: 'catalog.applications',
        operation: 'SELECT',
      });

      result = await client.query(applicationsQuery);

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

      // ✅ NOUVEAU: captureDatabaseError avec contexte spécifique
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
      return [];
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

      // ✅ NOUVEAU: captureMessage pour les problèmes de structure de données
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
      return [];
    }

    // ===== ÉTAPE 5: TRAITEMENT ET RETOUR DES DONNÉES =====
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

    // Mise en cache et logging de succès...
    const cacheSuccess = dashboardCache.applications.set(
      cacheKey,
      sanitizedApplications,
    );
    const responseTime = Date.now() - startTime;

    logger.info('Applications fetch successful (Server Component)', {
      applicationCount: sanitizedApplications.length,
      response_time_ms: responseTime,
      success: true,
      requestId,
      component: 'applications_server_component',
      action: 'fetch_success',
      entity: 'application',
      cacheMiss: true,
      cacheSet: cacheSuccess,
      execution_context: 'server_component',
    });

    // ✅ NOUVEAU: captureMessage de succès
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

    // ✅ NOUVEAU: captureException adapté pour Server Components
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
    return [];
  }
}

/**
 * Fonction pour vérifier l'authentification côté serveur
 * ✅ MISE À JOUR: Utilise la nouvelle architecture Sentry
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

      // ✅ NOUVEAU: captureMessage pour tentative d'accès non authentifiée
      captureMessage('Unauthenticated access attempt to applications page', {
        level: 'warning',
        tags: {
          component: 'applications_server_component',
          action: 'auth_check_failed',
          error_category: 'authentication',
          execution_context: 'server_component',
        },
        extra: {
          timestamp: new Date().toISOString(),
          page: 'applications',
        },
      });

      return null;
    }

    return session;
  } catch (error) {
    logger.error('Authentication check error (Server Component)', {
      error: error.message,
      component: 'applications_server_component',
      action: 'auth_check_error',
    });

    // ✅ NOUVEAU: captureException pour erreurs d'authentification
    captureException(error, {
      level: 'error',
      tags: {
        component: 'applications_server_component',
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
 * Server Component principal pour la page des applications
 * ✅ NOUVEAU: Wrappé avec monitoring automatique
 */
const ApplicationsPageComponent = async () => {
  try {
    // ===== ÉTAPE 1: VÉRIFICATION AUTHENTIFICATION =====
    const session = await checkAuthentication();

    if (!session) {
      redirect('/login');
    }

    // ===== ÉTAPE 2: RÉCUPÉRATION DES APPLICATIONS =====
    const applications = await getApplicationsFromDatabase();

    // ===== ÉTAPE 3: RENDU DE LA PAGE =====
    logger.info('Applications page rendering (Server Component)', {
      applicationCount: applications.length,
      userId: session.user?.id,
      component: 'applications_server_component',
      action: 'page_render',
      timestamp: new Date().toISOString(),
    });

    return <ApplicationsList data={applications} />;
  } catch (error) {
    logger.error('Applications page error (Server Component)', {
      error: error.message,
      stack: error.stack,
      component: 'applications_server_component',
      action: 'page_error',
    });

    // ✅ NOUVEAU: captureServerComponentError pour erreurs de rendu
    captureServerComponentError(error, {
      componentName: 'ApplicationsPage',
      route: '/dashboard/applications',
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
    return <ApplicationsList data={[]} />;
  }
};

// ✅ NOUVEAU: Export du composant avec monitoring automatique
const ApplicationsPage = withServerComponentMonitoring(
  ApplicationsPageComponent,
  'ApplicationsPage',
);

export default ApplicationsPage;
