import SingleApplication from '@/ui/pages/applications/SingleApplication';
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
import {
  applicationIdSchema,
  cleanUUID,
} from '@/utils/schemas/applicationSchema';
import { dashboardCache, getDashboardCacheKey } from '@/utils/cache';

// Configuration de revalidation pour cette page
export const revalidate = 0; // Désactive le cache statique
export const dynamic = 'force-dynamic'; // Force le rendu dynamique

/**
 * Fonction pour récupérer une application spécifique depuis la base de données
 * ✅ MISE À JOUR: Utilise la nouvelle architecture Sentry
 * @param {string} applicationId - L'ID de l'application à récupérer
 * @returns {Promise<Object|null>} Application ou null si non trouvée/erreur
 */
async function getApplicationFromDatabase(applicationId) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();

  logger.info('Application by ID fetch process started (Server Component)', {
    requestId,
    applicationId,
  });

  captureMessage(
    'Get application by ID process started from Server Component',
    {
      level: 'info',
      tags: {
        component: 'application_by_id_server_component',
        action: 'process_start',
        entity: 'application',
        execution_context: 'server_component',
        operation: 'read',
      },
      extra: {
        requestId,
        applicationId,
      },
    },
  );

  try {
    // ===== ÉTAPE 1: VALIDATION DE L'ID AVEC YUP =====
    try {
      await applicationIdSchema.validate(
        { id: applicationId },
        { abortEarly: false },
      );
    } catch (validationError) {
      const errorCategory = categorizeError(validationError);

      logger.warn(
        'Application ID validation failed with Yup (Server Component)',
        {
          category: errorCategory,
          providedId: applicationId,
          requestId,
        },
      );

      captureMessage(
        'Application ID validation failed with Yup schema (Server Component)',
        {
          level: 'warning',
          tags: {
            component: 'application_by_id_server_component',
            action: 'yup_id_validation_failed',
            error_category: 'validation',
            entity: 'application',
            operation: 'read',
            execution_context: 'server_component',
          },
          extra: {
            requestId,
            providedId: applicationId,
            failedFields: validationError.inner?.map((err) => err.path) || [],
          },
        },
      );

      return null;
    }

    // Nettoyer l'UUID pour garantir le format correct
    const cleanedApplicationId = cleanUUID(applicationId);
    if (!cleanedApplicationId) {
      logger.warn('Application ID cleaning failed (Server Component)', {
        requestId,
        providedId: applicationId,
      });

      return null;
    }

    // ===== ÉTAPE 2: VÉRIFICATION DU CACHE =====
    const cacheKey = getDashboardCacheKey('single_application', {
      endpoint: 'server_component_application_by_id',
      applicationId: cleanedApplicationId,
      version: '1.0',
    });

    const cachedApplication = dashboardCache.singleApplication.get(cacheKey);

    if (cachedApplication) {
      const responseTime = Date.now() - startTime;

      logger.info('Application served from cache (Server Component)', {
        applicationId: cleanedApplicationId,
        applicationName: cachedApplication.application_name,
        response_time_ms: responseTime,
        requestId,
      });

      return cachedApplication;
    }

    // ===== ÉTAPE 3: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error(
        'Database Connection Error during application fetch by ID (Server Component)',
        {
          category: errorCategory,
          message: dbConnectionError.message,
          requestId,
          applicationId: cleanedApplicationId,
        },
      );

      captureDatabaseError(dbConnectionError, {
        tags: {
          component: 'application_by_id_server_component',
          action: 'db_connection_failed',
          operation: 'connection',
          entity: 'application',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          applicationId: cleanedApplicationId,
        },
      });

      return null;
    }

    // ===== ÉTAPE 4: EXÉCUTION DE LA REQUÊTE =====
    let result;
    try {
      const applicationQuery = `
        SELECT 
          application_id,
          application_name,
          application_link,
          application_admin_link,
          application_description,
          application_fee,
          application_rent,
          application_images,
          application_category,
          application_other_versions,
          application_level,
          created_at,
          sales_count,
          is_active,
          updated_at
        FROM catalog.applications 
        WHERE application_id = $1
      `;

      result = await client.query(applicationQuery, [cleanedApplicationId]);
    } catch (queryError) {
      const errorCategory = categorizeError(queryError);

      logger.error('Application Fetch By ID Query Error (Server Component)', {
        category: errorCategory,
        message: queryError.message,
        applicationId: cleanedApplicationId,
        requestId,
      });

      captureDatabaseError(queryError, {
        tags: {
          component: 'application_by_id_server_component',
          action: 'query_failed',
          operation: 'SELECT',
          entity: 'application',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          applicationId: cleanedApplicationId,
          table: 'catalog.applications',
          queryType: 'application_fetch_by_id',
        },
      });

      if (client) await client.cleanup();
      return null;
    }

    // ===== ÉTAPE 5: VÉRIFICATION EXISTENCE DE L'APPLICATION =====
    if (result.rows.length === 0) {
      logger.warn('Application not found (Server Component)', {
        requestId,
        applicationId: cleanedApplicationId,
      });

      captureMessage('Application not found (Server Component)', {
        level: 'warning',
        tags: {
          component: 'application_by_id_server_component',
          action: 'application_not_found',
          error_category: 'business_logic',
          entity: 'application',
          operation: 'read',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          applicationId: cleanedApplicationId,
        },
      });

      if (client) await client.cleanup();
      return null;
    }

    // ===== ÉTAPE 6: FORMATAGE DES DONNÉES =====
    const application = result.rows[0];
    const sanitizedApplication = {
      application_id: application.application_id,
      application_name: application.application_name || '[No Name]',
      application_link: application.application_link || '[No Link]',
      application_admin_link: application.application_admin_link || '[No Link]',
      application_description:
        application.application_description || '[No Description]',
      application_images: application.application_images,
      application_category: application.application_category || '[No Category]',
      application_level: application.application_level || '[No Level]',
      application_other_versions:
        application.application_other_versions || '[No Other Versions]',
      application_fee: parseFloat(application.application_fee) || 0.0,
      application_rent: parseFloat(application.application_rent) || 0.0,
      created_at: application.created_at,
      sales_count: parseInt(application.sales_count) || 0,
      is_active: Boolean(application.is_active),
      updated_at: application.updated_at,
    };

    // ===== ÉTAPE 7: MISE EN CACHE DES DONNÉES =====
    dashboardCache.singleApplication.set(cacheKey, sanitizedApplication);

    // ===== ÉTAPE 8: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Application fetch by ID successful (Server Component)', {
      applicationId: cleanedApplicationId,
      applicationName: sanitizedApplication.application_name,
      response_time_ms: responseTime,
      requestId,
    });

    captureMessage(
      'Application fetch by ID completed successfully (Server Component)',
      {
        level: 'info',
        tags: {
          component: 'application_by_id_server_component',
          action: 'fetch_by_id_success',
          success: 'true',
          entity: 'application',
          operation: 'read',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          applicationId: cleanedApplicationId,
          applicationName: sanitizedApplication.application_name,
          responseTimeMs: responseTime,
        },
      },
    );

    if (client) await client.cleanup();

    return sanitizedApplication;
  } catch (error) {
    // ===== GESTION GLOBALE DES ERREURS =====
    const errorCategory = categorizeError(error);
    const responseTime = Date.now() - startTime;

    logger.error('Global Application By ID Error (Server Component)', {
      category: errorCategory,
      response_time_ms: responseTime,
      error_message: error.message,
      requestId,
      applicationId,
    });

    captureException(error, {
      level: 'error',
      tags: {
        component: 'application_by_id_server_component',
        action: 'global_error_handler',
        error_category: errorCategory,
        critical: 'true',
        entity: 'application',
        operation: 'read',
        execution_context: 'server_component',
      },
      extra: {
        requestId,
        applicationId,
        responseTimeMs: responseTime,
        process: 'application_fetch_by_id_server_component',
      },
    });

    if (client) await client.cleanup();

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
      logger.warn('Unauthenticated access attempt to application view page');

      captureMessage(
        'Unauthenticated access attempt to application view page',
        {
          level: 'warning',
          tags: {
            component: 'application_by_id_server_component',
            action: 'auth_check_failed',
            error_category: 'authentication',
            execution_context: 'server_component',
          },
          extra: {
            page: 'application_view',
          },
        },
      );

      return null;
    }

    return session;
  } catch (error) {
    logger.error('Authentication check error (Server Component)', {
      error: error.message,
    });

    captureException(error, {
      level: 'error',
      tags: {
        component: 'application_by_id_server_component',
        action: 'auth_check_error',
        error_category: 'authentication',
        execution_context: 'server_component',
      },
    });

    return null;
  }
}

/**
 * Server Component principal pour la page de visualisation d'une application
 * ✅ NOUVEAU: Wrappé avec monitoring automatique
 */
const SingleApplicationPageComponent = async ({ params }) => {
  try {
    // Attendre les paramètres (requis en Next.js 15)
    const { id } = await params;

    // ===== ÉTAPE 1: VÉRIFICATION AUTHENTIFICATION =====
    const session = await checkAuthentication();

    if (!session) {
      redirect('/login');
    }

    // ===== ÉTAPE 2: RÉCUPÉRATION DE L'APPLICATION =====
    const application = await getApplicationFromDatabase(id);

    // ===== ÉTAPE 3: VÉRIFICATION EXISTENCE =====
    if (!application) {
      notFound();
    }

    // ===== ÉTAPE 4: RENDU DE LA PAGE =====
    logger.info('Application view page rendering (Server Component)', {
      applicationId: application.application_id,
      applicationName: application.application_name,
      userId: session.user?.id,
    });

    return <SingleApplication data={application} />;
  } catch (error) {
    logger.error('Application view page error (Server Component)', {
      error: error.message,
    });

    captureServerComponentError(error, {
      componentName: 'SingleApplicationPage',
      route: '/dashboard/applications/[id]',
      action: 'page_render',
      tags: {
        critical: 'true',
        page_type: 'dashboard',
      },
    });

    notFound();
  }
};

// ✅ NOUVEAU: Export du composant avec monitoring automatique
const SingleApplicationPage = withServerComponentMonitoring(
  SingleApplicationPageComponent,
  'SingleApplicationPage',
);

export default SingleApplicationPage;
