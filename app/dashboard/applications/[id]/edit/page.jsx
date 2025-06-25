import EditApplication from '@/ui/pages/applications/EditApplication';
import { getServerSession } from 'next-auth';
import { auth } from '@app/api/auth/[...nextauth]/route';
import { getClient } from '@backend/dbConnect';
import { redirect, notFound } from 'next/navigation';
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
  applicationIdSchema,
  cleanUUID,
} from '@/utils/schemas/applicationSchema';
import {
  dashboardCache,
  getDashboardCacheKey,
  // invalidateDashboardCache,
} from '@/utils/cache';

// Configuration de revalidation pour cette page
export const revalidate = 0; // Désactive le cache statique
export const dynamic = 'force-dynamic'; // Force le rendu dynamique

/**
 * Fonction pour récupérer une application spécifique depuis la base de données pour édition
 * Cette fonction remplace l'appel API et s'exécute directement côté serveur
 * @param {string} applicationId - L'ID de l'application à récupérer
 * @returns {Promise<Object|null>} Application ou null si non trouvée/erreur
 */
async function getApplicationForEditFromDatabase(applicationId) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();

  logger.info('Application for edit fetch process started (Server Component)', {
    timestamp: new Date().toISOString(),
    requestId,
    component: 'edit_application_server_component',
    action: 'fetch_start',
    method: 'SERVER_COMPONENT',
    operation: 'get_application_for_edit',
    applicationId,
  });

  // Capturer le début du processus de récupération de l'application pour édition
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
    logger.debug(
      'Validating application ID with Yup schema (Server Component)',
      {
        requestId,
        component: 'edit_application_server_component',
        action: 'id_validation_start',
        operation: 'get_application_for_edit',
        providedId: applicationId,
      },
    );

    try {
      // Valider l'ID avec le schema Yup
      await applicationIdSchema.validate(
        { id: applicationId },
        { abortEarly: false },
      );

      logger.debug(
        'Application ID validation with Yup passed (Server Component)',
        {
          requestId,
          component: 'edit_application_server_component',
          action: 'yup_id_validation_success',
          operation: 'get_application_for_edit',
          applicationId,
        },
      );
    } catch (validationError) {
      const errorCategory = categorizeError(validationError);

      logger.warn(
        'Application ID validation failed with Yup (Server Component)',
        {
          category: errorCategory,
          providedId: applicationId,
          failed_fields: validationError.inner?.map((err) => err.path) || [],
          total_errors: validationError.inner?.length || 0,
          requestId,
          component: 'edit_application_server_component',
          action: 'yup_id_validation_failed',
          operation: 'get_application_for_edit',
        },
      );

      // Capturer l'erreur de validation avec Sentry
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
      logger.warn('Application ID cleaning failed (Server Component)', {
        requestId,
        component: 'edit_application_server_component',
        action: 'id_cleaning_failed',
        operation: 'get_application_for_edit',
        providedId: applicationId,
      });

      return null;
    }

    logger.debug(
      'Application ID validation and cleaning passed (Server Component)',
      {
        requestId,
        component: 'edit_application_server_component',
        action: 'id_validation_success',
        operation: 'get_application_for_edit',
        originalId: applicationId,
        cleanedId: cleanedApplicationId,
      },
    );

    // ===== ÉTAPE 2: VÉRIFICATION DU CACHE =====
    const cacheKey = getDashboardCacheKey('edit_application', {
      endpoint: 'server_component_application_edit',
      applicationId: cleanedApplicationId,
      version: '1.0',
    });

    logger.debug('Checking cache for application edit (Server Component)', {
      requestId,
      component: 'edit_application_server_component',
      action: 'cache_check_start',
      cacheKey,
      applicationId: cleanedApplicationId,
    });

    // Vérifier si les données sont en cache
    const cachedApplication = dashboardCache.singleApplication.get(cacheKey);

    if (cachedApplication) {
      const responseTime = Date.now() - startTime;

      logger.info('Application for edit served from cache (Server Component)', {
        applicationId: cleanedApplicationId,
        applicationName: cachedApplication.application_name,
        response_time_ms: responseTime,
        cache_hit: true,
        requestId,
        component: 'edit_application_server_component',
        action: 'cache_hit',
        entity: 'application',
      });

      // Capturer le succès du cache avec Sentry
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

    logger.debug('Cache miss, fetching from database (Server Component)', {
      requestId,
      component: 'edit_application_server_component',
      action: 'cache_miss',
      applicationId: cleanedApplicationId,
    });

    // ===== ÉTAPE 3: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
      logger.debug('Database connection successful (Server Component)', {
        requestId,
        component: 'edit_application_server_component',
        action: 'db_connection_success',
        operation: 'get_application_for_edit',
        applicationId: cleanedApplicationId,
      });
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error(
        'Database Connection Error during application fetch for edit (Server Component)',
        {
          category: errorCategory,
          message: dbConnectionError.message,
          timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
          requestId,
          component: 'edit_application_server_component',
          action: 'db_connection_failed',
          operation: 'get_application_for_edit',
          applicationId: cleanedApplicationId,
        },
      );

      // Capturer l'erreur de connexion DB avec Sentry
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

      logger.debug(
        'Executing application fetch for edit query (Server Component)',
        {
          requestId,
          component: 'edit_application_server_component',
          action: 'query_start',
          operation: 'get_application_for_edit',
          applicationId: cleanedApplicationId,
          table: 'catalog.applications',
        },
      );

      result = await client.query(applicationQuery, [cleanedApplicationId]);

      logger.debug(
        'Application fetch for edit query executed successfully (Server Component)',
        {
          requestId,
          component: 'edit_application_server_component',
          action: 'query_success',
          operation: 'get_application_for_edit',
          applicationId: cleanedApplicationId,
          rowCount: result.rows.length,
        },
      );
    } catch (queryError) {
      const errorCategory = categorizeError(queryError);

      logger.error(
        'Application Fetch For Edit Query Error (Server Component)',
        {
          category: errorCategory,
          message: queryError.message,
          query: 'application_fetch_for_edit',
          table: 'catalog.applications',
          applicationId: cleanedApplicationId,
          requestId,
          component: 'edit_application_server_component',
          action: 'query_failed',
          operation: 'get_application_for_edit',
        },
      );

      // Capturer l'erreur de requête avec Sentry
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
      logger.warn('Application not found for edit (Server Component)', {
        requestId,
        component: 'edit_application_server_component',
        action: 'application_not_found',
        operation: 'get_application_for_edit',
        applicationId: cleanedApplicationId,
      });

      // Capturer l'application non trouvée avec Sentry
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

    logger.debug('Application data sanitized for edit (Server Component)', {
      requestId,
      component: 'edit_application_server_component',
      action: 'data_sanitization',
      operation: 'get_application_for_edit',
      applicationId: cleanedApplicationId,
    });

    // ===== ÉTAPE 7: MISE EN CACHE DES DONNÉES =====
    logger.debug('Caching application edit data (Server Component)', {
      requestId,
      component: 'edit_application_server_component',
      action: 'cache_set_start',
      applicationId: cleanedApplicationId,
    });

    // Mettre les données en cache
    const cacheSuccess = dashboardCache.singleApplication.set(
      cacheKey,
      sanitizedApplication,
    );

    if (cacheSuccess) {
      logger.debug(
        'Application edit data cached successfully (Server Component)',
        {
          requestId,
          component: 'edit_application_server_component',
          action: 'cache_set_success',
          cacheKey,
          applicationId: cleanedApplicationId,
        },
      );
    } else {
      logger.warn('Failed to cache application edit data (Server Component)', {
        requestId,
        component: 'edit_application_server_component',
        action: 'cache_set_failed',
        cacheKey,
        applicationId: cleanedApplicationId,
      });
    }

    // ===== ÉTAPE 8: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Application fetch for edit successful (Server Component)', {
      applicationId: cleanedApplicationId,
      applicationName: sanitizedApplication.application_name,
      response_time_ms: responseTime,
      database_operations: 2, // connection + query
      success: true,
      requestId,
      component: 'edit_application_server_component',
      action: 'fetch_for_edit_success',
      entity: 'application',
      cacheMiss: true,
      cacheSet: cacheSuccess,
      execution_context: 'server_component',
      operation: 'get_application_for_edit',
      yupValidationApplied: true,
    });

    // Capturer le succès de la récupération avec Sentry
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

    logger.error('Global Application For Edit Error (Server Component)', {
      category: errorCategory,
      response_time_ms: responseTime,
      reached_global_handler: true,
      error_name: error.name,
      error_message: error.message,
      stack_available: !!error.stack,
      requestId,
      applicationId,
      component: 'edit_application_server_component',
      action: 'global_error_handler',
      entity: 'application',
      operation: 'get_application_for_edit',
      execution_context: 'server_component',
    });

    // Capturer l'erreur globale avec Sentry
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
 * @returns {Promise<Object|null>} Session utilisateur ou null si non authentifié
 */
async function checkAuthentication() {
  try {
    const session = await getServerSession(auth);

    if (!session) {
      logger.warn('Unauthenticated access attempt to application edit page', {
        component: 'edit_application_server_component',
        action: 'auth_check_failed',
        timestamp: new Date().toISOString(),
      });

      // Capturer la tentative d'accès non authentifiée
      captureMessage(
        'Unauthenticated access attempt to application edit page',
        {
          level: 'warning',
          tags: {
            component: 'edit_application_server_component',
            action: 'auth_check_failed',
            error_category: 'authentication',
          },
          extra: {
            timestamp: new Date().toISOString(),
            page: 'application_edit',
          },
        },
      );

      return null;
    }

    logger.debug(
      'User authentication verified successfully (Server Component)',
      {
        userId: session.user?.id,
        email: session.user?.email?.substring(0, 3) + '***',
        component: 'edit_application_server_component',
        action: 'auth_verification_success',
      },
    );

    return session;
  } catch (error) {
    logger.error('Authentication check error (Server Component)', {
      error: error.message,
      component: 'edit_application_server_component',
      action: 'auth_check_error',
    });

    captureException(error, {
      level: 'error',
      tags: {
        component: 'edit_application_server_component',
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
 * Server Component principal pour la page d'édition d'une application
 * Cette fonction s'exécute côté serveur et remplace l'appel API
 */
const EditApplicationPage = async ({ params }) => {
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
    logger.info('Application edit page rendering (Server Component)', {
      applicationId: application.application_id,
      applicationName: application.application_name,
      userId: session.user?.id,
      component: 'edit_application_server_component',
      action: 'page_render',
      timestamp: new Date().toISOString(),
    });

    return <EditApplication application={application} />;
  } catch (error) {
    // Gestion des erreurs au niveau de la page
    logger.error('Application edit page error (Server Component)', {
      error: error.message,
      stack: error.stack,
      component: 'edit_application_server_component',
      action: 'page_error',
    });

    captureException(error, {
      level: 'error',
      tags: {
        component: 'edit_application_server_component',
        action: 'page_error',
        error_category: 'page_rendering',
        critical: 'true',
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

export default EditApplicationPage;
