// app/dashboard/applications/page.jsx
// Exemple d'utilisation de la nouvelle architecture Sentry dans un Server Component

import ApplicationsList from '@/ui/pages/applications/ApplicationsList';
import { getServerSession } from 'next-auth';
import { auth } from '@app/api/auth/[...nextauth]/route';
import { getClient } from '@backend/dbConnect';
import { redirect } from 'next/navigation';

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
    requestId,
    component: 'applications_server_component',
  });

  try {
    // ===== ÉTAPE 1: VÉRIFICATION DU CACHE =====
    const cacheKey = getDashboardCacheKey('applications_list', {
      endpoint: 'server_component_applications',
      version: '1.0',
    });

    const cachedApplications = dashboardCache.applications.get(cacheKey);

    if (cachedApplications) {
      const responseTime = Date.now() - startTime;

      logger.info('Applications served from cache (Server Component)', {
        applicationCount: cachedApplications.length,
        response_time_ms: responseTime,
        requestId,
      });

      return cachedApplications;
    }

    // ===== ÉTAPE 2: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error(
        'Database Connection Error during applications fetch (Server Component)',
        {
          category: errorCategory,
          message: dbConnectionError.message,
          requestId,
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

      result = await client.query(applicationsQuery);
    } catch (queryError) {
      const errorCategory = categorizeError(queryError);

      logger.error('Applications Query Error (Server Component)', {
        category: errorCategory,
        message: queryError.message,
        requestId,
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
          resultType: typeof result,
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
    dashboardCache.applications.set(cacheKey, sanitizedApplications);
    const responseTime = Date.now() - startTime;

    logger.info('Applications fetch successful (Server Component)', {
      applicationCount: sanitizedApplications.length,
      response_time_ms: responseTime,
      requestId,
    });

    if (client) await client.cleanup();
    return sanitizedApplications;
  } catch (error) {
    // ===== GESTION GLOBALE DES ERREURS =====
    const errorCategory = categorizeError(error);
    const responseTime = Date.now() - startTime;

    logger.error('Global Applications Error (Server Component)', {
      category: errorCategory,
      response_time_ms: responseTime,
      error_message: error.message,
      requestId,
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
      logger.warn('Unauthenticated access attempt to applications page');

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
          page: 'applications',
        },
      });

      return null;
    }

    return session;
  } catch (error) {
    logger.error('Authentication check error (Server Component)', {
      error: error.message,
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
    });

    return <ApplicationsList data={applications} />;
  } catch (error) {
    logger.error('Applications page error (Server Component)', {
      error: error.message,
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
