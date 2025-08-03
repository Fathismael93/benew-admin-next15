import EditApplication from '@/ui/pages/applications/EditApplication';
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
 * Fonction pour récupérer une application spécifique depuis la base de données pour édition
 * ✅ MISE À JOUR: Utilise la nouvelle architecture Sentry
 * @param {string} applicationId - L'ID de l'application à récupérer
 * @returns {Promise<Object|null>} Application ou null si non trouvée/erreur
 */
async function getApplicationForEditFromDatabase(applicationId) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();

  logger.info('Application for edit fetch process started', {
    requestId,
    applicationId,
  });

  // ✅ NOUVEAU: Utilisation des fonctions Sentry adaptées
  captureMessage(
    'Get application for edit process started from Server Component',
    {
      level: 'info',
      tags: {
        component: 'edit_application_server_component',
        action: 'process_start',
        entity: 'application',
        execution_context: 'server_component',
        operation: 'read_for_edit',
      },
      extra: {
        requestId,
        applicationId,
        timestamp: new Date().toISOString(),
        method: 'SERVER_COMPONENT',
      },
    },
  );

  try {
    // ===== ÉTAPE 1: VALIDATION DE L'ID AVEC YUP =====
    try {
      // Valider l'ID avec le schema Yup
      await applicationIdSchema.validate(
        { id: applicationId },
        { abortEarly: false },
      );
    } catch (validationError) {
      const errorCategory = categorizeError(validationError);

      logger.warn('Application ID validation failed with Yup', {
        category: errorCategory,
        providedId: applicationId,
        failed_fields: validationError.inner?.map((err) => err.path) || [],
        requestId,
      });

      // ✅ NOUVEAU: captureMessage pour les problèmes de validation
      captureMessage(
        'Application ID validation failed with Yup schema (Edit) (Server Component)',
        {
          level: 'warning',
          tags: {
            component: 'edit_application_server_component',
            action: 'yup_id_validation_failed',
            error_category: 'validation',
            entity: 'application',
            operation: 'read_for_edit',
            execution_context: 'server_component',
          },
          extra: {
            requestId,
            providedId: applicationId,
            failedFields: validationError.inner?.map((err) => err.path) || [],
            totalErrors: validationError.inner?.length || 0,
            validationErrors:
              validationError.inner?.map((err) => ({
                field: err.path,
                message: err.message,
              })) || [],
          },
        },
      );

      // ID invalide, retourner null pour déclencher notFound()
      return null;
    }

    // Nettoyer l'UUID pour garantir le format correct
    const cleanedApplicationId = cleanUUID(applicationId);
    if (!cleanedApplicationId) {
      logger.warn('Application ID cleaning failed', {
        requestId,
        providedId: applicationId,
      });

      return null;
    }

    // ===== ÉTAPE 2: VÉRIFICATION DU CACHE =====
    const cacheKey = getDashboardCacheKey('edit_application', {
      endpoint: 'server_component_application_edit',
      applicationId: cleanedApplicationId,
      version: '1.0',
    });

    // Vérifier si les données sont en cache
    const cachedApplication = dashboardCache.singleApplication.get(cacheKey);

    if (cachedApplication) {
      const responseTime = Date.now() - startTime;

      logger.info('Application for edit served from cache', {
        applicationId: cleanedApplicationId,
        applicationName: cachedApplication.application_name,
        response_time_ms: responseTime,
        requestId,
      });

      // ✅ NOUVEAU: captureMessage adapté pour Server Components
      captureMessage(
        'Application for edit served from cache successfully (Server Component)',
        {
          level: 'info',
          tags: {
            component: 'edit_application_server_component',
            action: 'cache_hit',
            success: 'true',
            entity: 'application',
            execution_context: 'server_component',
            operation: 'read_for_edit',
          },
          extra: {
            requestId,
            applicationId: cleanedApplicationId,
            applicationName: cachedApplication.application_name,
            responseTimeMs: responseTime,
            cacheKey,
          },
        },
      );

      return cachedApplication;
    }

    // ===== ÉTAPE 3: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error(
        'Database Connection Error during application fetch for edit',
        {
          category: errorCategory,
          message: dbConnectionError.message,
          requestId,
          applicationId: cleanedApplicationId,
        },
      );

      // ✅ NOUVEAU: captureDatabaseError adapté pour Server Components
      captureDatabaseError(dbConnectionError, {
        tags: {
          component: 'edit_application_server_component',
          action: 'db_connection_failed',
          operation: 'connection',
          entity: 'application',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          applicationId: cleanedApplicationId,
          timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
        },
      });

      // Retourner null plutôt que de faire planter la page
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

      logger.error('Application Fetch For Edit Query Error', {
        category: errorCategory,
        message: queryError.message,
        applicationId: cleanedApplicationId,
        requestId,
      });

      // ✅ NOUVEAU: captureDatabaseError avec contexte spécifique
      captureDatabaseError(queryError, {
        tags: {
          component: 'edit_application_server_component',
          action: 'query_failed',
          operation: 'SELECT',
          entity: 'application',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          applicationId: cleanedApplicationId,
          table: 'catalog.applications',
          queryType: 'application_fetch_for_edit',
          postgresCode: queryError.code,
          postgresDetail: queryError.detail ? '[Filtered]' : undefined,
        },
      });

      if (client) await client.cleanup();
      return null; // Retourner null plutôt que de faire planter la page
    }

    // ===== ÉTAPE 5: VÉRIFICATION EXISTENCE DE L'APPLICATION =====
    if (result.rows.length === 0) {
      logger.warn('Application not found for edit', {
        requestId,
        applicationId: cleanedApplicationId,
      });

      // ✅ NOUVEAU: captureMessage pour les problèmes de logique métier
      captureMessage('Application not found for edit (Server Component)', {
        level: 'warning',
        tags: {
          component: 'edit_application_server_component',
          action: 'application_not_found',
          error_category: 'business_logic',
          entity: 'application',
          operation: 'read_for_edit',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          applicationId: cleanedApplicationId,
        },
      });

      if (client) await client.cleanup();
      return null; // Application non trouvée
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
    // Mettre les données en cache
    const cacheSuccess = dashboardCache.singleApplication.set(
      cacheKey,
      sanitizedApplication,
    );

    if (!cacheSuccess) {
      logger.warn('Failed to cache application edit data', {
        requestId,
        applicationId: cleanedApplicationId,
      });
    }

    // ===== ÉTAPE 8: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Application fetch for edit successful', {
      applicationId: cleanedApplicationId,
      applicationName: sanitizedApplication.application_name,
      response_time_ms: responseTime,
      requestId,
    });

    // ✅ NOUVEAU: captureMessage de succès
    captureMessage(
      'Application fetch for edit completed successfully (Server Component)',
      {
        level: 'info',
        tags: {
          component: 'edit_application_server_component',
          action: 'fetch_for_edit_success',
          success: 'true',
          entity: 'application',
          operation: 'read_for_edit',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          applicationId: cleanedApplicationId,
          applicationName: sanitizedApplication.application_name,
          responseTimeMs: responseTime,
          databaseOperations: 2,
          cacheMiss: true,
          cacheSet: cacheSuccess,
        },
      },
    );

    if (client) await client.cleanup();

    return sanitizedApplication;
  } catch (error) {
    // ===== GESTION GLOBALE DES ERREURS =====
    const errorCategory = categorizeError(error);
    const responseTime = Date.now() - startTime;

    logger.error('Global Application For Edit Error', {
      category: errorCategory,
      response_time_ms: responseTime,
      error_message: error.message,
      requestId,
      applicationId,
    });

    // ✅ NOUVEAU: captureException adapté pour Server Components
    captureException(error, {
      level: 'error',
      tags: {
        component: 'edit_application_server_component',
        action: 'global_error_handler',
        error_category: errorCategory,
        critical: 'true',
        entity: 'application',
        operation: 'read_for_edit',
        execution_context: 'server_component',
      },
      extra: {
        requestId,
        applicationId,
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'application_fetch_for_edit_server_component',
      },
    });

    if (client) await client.cleanup();

    // En cas d'erreur grave, retourner null pour déclencher notFound()
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
      logger.warn('Unauthenticated access attempt to application edit page');

      // ✅ NOUVEAU: captureMessage pour tentative d'accès non authentifiée
      captureMessage(
        'Unauthenticated access attempt to application edit page',
        {
          level: 'warning',
          tags: {
            component: 'edit_application_server_component',
            action: 'auth_check_failed',
            error_category: 'authentication',
            execution_context: 'server_component',
          },
          extra: {
            timestamp: new Date().toISOString(),
            page: 'application_edit',
          },
        },
      );

      return null;
    }

    return session;
  } catch (error) {
    logger.error('Authentication check error', {
      error: error.message,
    });

    // ✅ NOUVEAU: captureException pour erreurs d'authentification
    captureException(error, {
      level: 'error',
      tags: {
        component: 'edit_application_server_component',
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
 * Server Component principal pour la page d'édition d'une application
 * ✅ NOUVEAU: Wrappé avec monitoring automatique
 */
const EditApplicationPageComponent = async ({ params }) => {
  try {
    // Attendre les paramètres (requis en Next.js 15)
    const { id } = await params;

    // ===== ÉTAPE 1: VÉRIFICATION AUTHENTIFICATION =====
    const session = await checkAuthentication();

    if (!session) {
      // Rediriger vers la page de login si non authentifié
      redirect('/login');
    }

    // ===== ÉTAPE 2: RÉCUPÉRATION DE L'APPLICATION =====
    const application = await getApplicationForEditFromDatabase(id);

    // ===== ÉTAPE 3: VÉRIFICATION EXISTENCE =====
    if (!application) {
      // Application non trouvée ou ID invalide, afficher 404
      notFound();
    }

    // ===== ÉTAPE 4: RENDU DE LA PAGE =====
    logger.info('Application edit page rendering', {
      applicationId: application.application_id,
      applicationName: application.application_name,
      userId: session.user?.id,
    });

    return <EditApplication application={application} />;
  } catch (error) {
    // Gestion des erreurs au niveau de la page
    logger.error('Application edit page error', {
      error: error.message,
    });

    // ✅ NOUVEAU: captureServerComponentError pour erreurs de rendu
    captureServerComponentError(error, {
      componentName: 'EditApplicationPage',
      route: '/dashboard/applications/[id]/edit',
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

    // En cas d'erreur critique, rediriger vers 404
    notFound();
  }
};

// ✅ NOUVEAU: Export du composant avec monitoring automatique
const EditApplicationPage = withServerComponentMonitoring(
  EditApplicationPageComponent,
  'EditApplicationPage',
);

export default EditApplicationPage;
