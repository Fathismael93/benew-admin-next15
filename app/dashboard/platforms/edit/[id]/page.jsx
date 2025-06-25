import EditPlatform from '@ui/pages/platforms/EditPlatform';
import { getServerSession } from 'next-auth';
import { auth } from '@app/api/auth/[...nextauth]/route';
import { getClient } from '@backend/dbConnect';
import { redirect, notFound } from 'next/navigation';
import {
  captureException,
  captureMessage,
  captureDatabaseError,
} from '@/monitoring/sentry';
import { categorizeError, generateRequestId } from '@/utils/helpers';
import logger from '@/utils/logger';
import { platformIdSchema } from '@/utils/schemas/platformSchema';
import { dashboardCache, getDashboardCacheKey } from '@/utils/cache';

// Configuration de revalidation pour cette page
export const revalidate = 0; // Désactive le cache statique
export const dynamic = 'force-dynamic'; // Force le rendu dynamique

// ----- FONCTION UTILITAIRE POUR NETTOYER L'UUID -----
const cleanUUID = (uuid) => {
  if (!uuid || typeof uuid !== 'string') {
    return null;
  }

  // Nettoyer et normaliser l'UUID
  const cleaned = uuid.toLowerCase().trim();

  // Vérifier le format UUID
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  return uuidRegex.test(cleaned) ? cleaned : null;
};

/**
 * Fonction pour récupérer une plateforme spécifique depuis la base de données pour édition
 * Cette fonction remplace l'appel API et s'exécute directement côté serveur
 * @param {string} platformId - L'ID de la plateforme à récupérer
 * @returns {Promise<Object|null>} Plateforme ou null si non trouvée/erreur
 */
async function getPlatformForEditFromDatabase(platformId) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();

  logger.info('Platform for edit fetch process started (Server Component)', {
    timestamp: new Date().toISOString(),
    requestId,
    component: 'edit_platform_server_component',
    action: 'fetch_start',
    method: 'SERVER_COMPONENT',
    operation: 'get_platform_for_edit',
    platformId,
  });

  // Capturer le début du processus de récupération de la plateforme pour édition
  captureMessage(
    'Get platform for edit process started from Server Component',
    {
      level: 'info',
      tags: {
        component: 'edit_platform_server_component',
        action: 'process_start',
        entity: 'platform',
        execution_context: 'server_component',
        operation: 'read_for_edit',
      },
      extra: {
        requestId,
        platformId,
        timestamp: new Date().toISOString(),
        method: 'SERVER_COMPONENT',
      },
    },
  );

  try {
    // ===== ÉTAPE 1: VALIDATION DE L'ID AVEC YUP =====
    logger.debug('Validating platform ID with Yup schema (Server Component)', {
      requestId,
      component: 'edit_platform_server_component',
      action: 'id_validation_start',
      operation: 'get_platform_for_edit',
      providedId: platformId,
    });

    try {
      // Valider l'ID avec le schema Yup
      await platformIdSchema.validate(
        { id: platformId },
        { abortEarly: false },
      );

      logger.debug(
        'Platform ID validation with Yup passed (Server Component)',
        {
          requestId,
          component: 'edit_platform_server_component',
          action: 'yup_id_validation_success',
          operation: 'get_platform_for_edit',
          platformId,
        },
      );
    } catch (validationError) {
      const errorCategory = categorizeError(validationError);

      logger.warn('Platform ID validation failed with Yup (Server Component)', {
        category: errorCategory,
        providedId: platformId,
        failed_fields: validationError.inner?.map((err) => err.path) || [],
        total_errors: validationError.inner?.length || 0,
        requestId,
        component: 'edit_platform_server_component',
        action: 'yup_id_validation_failed',
        operation: 'get_platform_for_edit',
      });

      // Capturer l'erreur de validation avec Sentry
      captureMessage(
        'Platform ID validation failed with Yup schema (Edit) (Server Component)',
        {
          level: 'warning',
          tags: {
            component: 'edit_platform_server_component',
            action: 'yup_id_validation_failed',
            error_category: 'validation',
            entity: 'platform',
            operation: 'read_for_edit',
            execution_context: 'server_component',
          },
          extra: {
            requestId,
            providedId: platformId,
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
    const cleanedPlatformId = cleanUUID(platformId);
    if (!cleanedPlatformId) {
      logger.warn('Platform ID cleaning failed (Server Component)', {
        requestId,
        component: 'edit_platform_server_component',
        action: 'id_cleaning_failed',
        operation: 'get_platform_for_edit',
        providedId: platformId,
      });

      return null;
    }

    logger.debug(
      'Platform ID validation and cleaning passed (Server Component)',
      {
        requestId,
        component: 'edit_platform_server_component',
        action: 'id_validation_success',
        operation: 'get_platform_for_edit',
        originalId: platformId,
        cleanedId: cleanedPlatformId,
      },
    );

    // ===== ÉTAPE 2: VÉRIFICATION DU CACHE =====
    const cacheKey = getDashboardCacheKey('edit_platform', {
      endpoint: 'server_component_platform_edit',
      platformId: cleanedPlatformId,
      version: '1.0',
    });

    logger.debug('Checking cache for platform edit (Server Component)', {
      requestId,
      component: 'edit_platform_server_component',
      action: 'cache_check_start',
      cacheKey,
      platformId: cleanedPlatformId,
    });

    // Vérifier si les données sont en cache
    const cachedPlatform = dashboardCache.platforms.get(cacheKey);

    if (cachedPlatform) {
      const responseTime = Date.now() - startTime;

      logger.info('Platform for edit served from cache (Server Component)', {
        platformId: cleanedPlatformId,
        platformName: cachedPlatform.platform_name,
        response_time_ms: responseTime,
        cache_hit: true,
        requestId,
        component: 'edit_platform_server_component',
        action: 'cache_hit',
        entity: 'platform',
        containsSensitiveData: true,
      });

      // Capturer le succès du cache avec Sentry
      captureMessage(
        'Platform for edit served from cache successfully (Server Component)',
        {
          level: 'info',
          tags: {
            component: 'edit_platform_server_component',
            action: 'cache_hit',
            success: 'true',
            entity: 'platform',
            execution_context: 'server_component',
            operation: 'read_for_edit',
          },
          extra: {
            requestId,
            platformId: cleanedPlatformId,
            platformName: cachedPlatform.platform_name,
            responseTimeMs: responseTime,
            cacheKey,
            containsSensitiveData: true,
          },
        },
      );

      return cachedPlatform;
    }

    logger.debug('Cache miss, fetching from database (Server Component)', {
      requestId,
      component: 'edit_platform_server_component',
      action: 'cache_miss',
      platformId: cleanedPlatformId,
    });

    // ===== ÉTAPE 3: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
      logger.debug('Database connection successful (Server Component)', {
        requestId,
        component: 'edit_platform_server_component',
        action: 'db_connection_success',
        operation: 'get_platform_for_edit',
        platformId: cleanedPlatformId,
      });
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error(
        'Database Connection Error during platform fetch for edit (Server Component)',
        {
          category: errorCategory,
          message: dbConnectionError.message,
          timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
          requestId,
          component: 'edit_platform_server_component',
          action: 'db_connection_failed',
          operation: 'get_platform_for_edit',
          platformId: cleanedPlatformId,
        },
      );

      // Capturer l'erreur de connexion DB avec Sentry
      captureDatabaseError(dbConnectionError, {
        tags: {
          component: 'edit_platform_server_component',
          action: 'db_connection_failed',
          operation: 'connection',
          entity: 'platform',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          platformId: cleanedPlatformId,
          timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
        },
      });

      // Retourner null plutôt que de faire planter la page
      return null;
    }

    // ===== ÉTAPE 4: EXÉCUTION DE LA REQUÊTE =====
    let result;
    try {
      const platformQuery = `
        SELECT 
          platform_id,
          platform_name,
          platform_number,
          created_at,
          updated_at,
          is_active
        FROM admin.platforms 
        WHERE platform_id = $1
      `;

      logger.debug(
        'Executing platform fetch for edit query (Server Component)',
        {
          requestId,
          component: 'edit_platform_server_component',
          action: 'query_start',
          operation: 'get_platform_for_edit',
          platformId: cleanedPlatformId,
          table: 'admin.platforms',
        },
      );

      result = await client.query(platformQuery, [cleanedPlatformId]);

      logger.debug(
        'Platform fetch for edit query executed successfully (Server Component)',
        {
          requestId,
          component: 'edit_platform_server_component',
          action: 'query_success',
          operation: 'get_platform_for_edit',
          platformId: cleanedPlatformId,
          rowCount: result.rows.length,
        },
      );
    } catch (queryError) {
      const errorCategory = categorizeError(queryError);

      logger.error('Platform Fetch For Edit Query Error (Server Component)', {
        category: errorCategory,
        message: queryError.message,
        query: 'platform_fetch_for_edit',
        table: 'admin.platforms',
        platformId: cleanedPlatformId,
        requestId,
        component: 'edit_platform_server_component',
        action: 'query_failed',
        operation: 'get_platform_for_edit',
      });

      // Capturer l'erreur de requête avec Sentry
      captureDatabaseError(queryError, {
        tags: {
          component: 'edit_platform_server_component',
          action: 'query_failed',
          operation: 'SELECT',
          entity: 'platform',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          platformId: cleanedPlatformId,
          table: 'admin.platforms',
          queryType: 'platform_fetch_for_edit',
          postgresCode: queryError.code,
          postgresDetail: queryError.detail ? '[Filtered]' : undefined,
        },
      });

      if (client) await client.cleanup();
      return null; // Retourner null plutôt que de faire planter la page
    }

    // ===== ÉTAPE 5: VÉRIFICATION EXISTENCE DE LA PLATEFORME =====
    if (result.rows.length === 0) {
      logger.warn('Platform not found for edit (Server Component)', {
        requestId,
        component: 'edit_platform_server_component',
        action: 'platform_not_found',
        operation: 'get_platform_for_edit',
        platformId: cleanedPlatformId,
      });

      // Capturer la plateforme non trouvée avec Sentry
      captureMessage('Platform not found for edit (Server Component)', {
        level: 'warning',
        tags: {
          component: 'edit_platform_server_component',
          action: 'platform_not_found',
          error_category: 'business_logic',
          entity: 'platform',
          operation: 'read_for_edit',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          platformId: cleanedPlatformId,
        },
      });

      if (client) await client.cleanup();
      return null; // Plateforme non trouvée
    }

    // ===== ÉTAPE 6: FORMATAGE DES DONNÉES =====
    const platform = result.rows[0];
    const sanitizedPlatform = {
      platform_id: platform.platform_id,
      platform_name: platform.platform_name || '[No Name]',
      // Pour l'édition, on retourne le numéro complet (nécessaire pour le formulaire)
      // Mais on le marque comme sensible dans les logs
      platform_number: platform.platform_number || '[No Number]',
      created_at: platform.created_at,
      updated_at: platform.updated_at,
      is_active: Boolean(platform.is_active),
    };

    logger.debug('Platform data sanitized for edit (Server Component)', {
      requestId,
      component: 'edit_platform_server_component',
      action: 'data_sanitization',
      operation: 'get_platform_for_edit',
      platformId: cleanedPlatformId,
      // Ne pas logger le numéro complet pour sécurité
      containsSensitiveData: true,
    });

    // ===== ÉTAPE 7: MISE EN CACHE DES DONNÉES =====
    logger.debug('Caching platform edit data (Server Component)', {
      requestId,
      component: 'edit_platform_server_component',
      action: 'cache_set_start',
      platformId: cleanedPlatformId,
    });

    // Mettre les données en cache
    const cacheSuccess = dashboardCache.platforms.set(
      cacheKey,
      sanitizedPlatform,
    );

    if (cacheSuccess) {
      logger.debug(
        'Platform edit data cached successfully (Server Component)',
        {
          requestId,
          component: 'edit_platform_server_component',
          action: 'cache_set_success',
          cacheKey,
          platformId: cleanedPlatformId,
        },
      );
    } else {
      logger.warn('Failed to cache platform edit data (Server Component)', {
        requestId,
        component: 'edit_platform_server_component',
        action: 'cache_set_failed',
        cacheKey,
        platformId: cleanedPlatformId,
      });
    }

    // ===== ÉTAPE 8: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Platform fetch for edit successful (Server Component)', {
      platformId: cleanedPlatformId,
      platformName: sanitizedPlatform.platform_name,
      response_time_ms: responseTime,
      database_operations: 2, // connection + query
      success: true,
      requestId,
      component: 'edit_platform_server_component',
      action: 'fetch_for_edit_success',
      entity: 'platform',
      cacheMiss: true,
      cacheSet: cacheSuccess,
      execution_context: 'server_component',
      operation: 'get_platform_for_edit',
      yupValidationApplied: true,
      containsSensitiveData: true,
    });

    // Capturer le succès de la récupération avec Sentry
    captureMessage(
      'Platform fetch for edit completed successfully (Server Component)',
      {
        level: 'info',
        tags: {
          component: 'edit_platform_server_component',
          action: 'fetch_for_edit_success',
          success: 'true',
          entity: 'platform',
          operation: 'read_for_edit',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          platformId: cleanedPlatformId,
          platformName: sanitizedPlatform.platform_name,
          responseTimeMs: responseTime,
          databaseOperations: 2,
          cacheMiss: true,
          cacheSet: cacheSuccess,
          containsSensitiveData: true,
        },
      },
    );

    if (client) await client.cleanup();

    return sanitizedPlatform;
  } catch (error) {
    // ===== GESTION GLOBALE DES ERREURS =====
    const errorCategory = categorizeError(error);
    const responseTime = Date.now() - startTime;

    logger.error('Global Platform For Edit Error (Server Component)', {
      category: errorCategory,
      response_time_ms: responseTime,
      reached_global_handler: true,
      error_name: error.name,
      error_message: error.message,
      stack_available: !!error.stack,
      requestId,
      platformId,
      component: 'edit_platform_server_component',
      action: 'global_error_handler',
      entity: 'platform',
      operation: 'get_platform_for_edit',
      execution_context: 'server_component',
    });

    // Capturer l'erreur globale avec Sentry
    captureException(error, {
      level: 'error',
      tags: {
        component: 'edit_platform_server_component',
        action: 'global_error_handler',
        error_category: errorCategory,
        critical: 'true',
        entity: 'platform',
        operation: 'read_for_edit',
        execution_context: 'server_component',
      },
      extra: {
        requestId,
        platformId,
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'platform_fetch_for_edit_server_component',
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
      logger.warn('Unauthenticated access attempt to platform edit page', {
        component: 'edit_platform_server_component',
        action: 'auth_check_failed',
        timestamp: new Date().toISOString(),
      });

      // Capturer la tentative d'accès non authentifiée
      captureMessage('Unauthenticated access attempt to platform edit page', {
        level: 'warning',
        tags: {
          component: 'edit_platform_server_component',
          action: 'auth_check_failed',
          error_category: 'authentication',
        },
        extra: {
          timestamp: new Date().toISOString(),
          page: 'platform_edit',
        },
      });

      return null;
    }

    logger.debug(
      'User authentication verified successfully (Server Component)',
      {
        userId: session.user?.id,
        email: session.user?.email?.substring(0, 3) + '***',
        component: 'edit_platform_server_component',
        action: 'auth_verification_success',
      },
    );

    return session;
  } catch (error) {
    logger.error('Authentication check error (Server Component)', {
      error: error.message,
      component: 'edit_platform_server_component',
      action: 'auth_check_error',
    });

    captureException(error, {
      level: 'error',
      tags: {
        component: 'edit_platform_server_component',
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
 * Server Component principal pour la page d'édition d'une plateforme
 * Cette fonction s'exécute côté serveur et remplace l'appel API
 */
const EditPlatformPage = async ({ params }) => {
  try {
    // Attendre les paramètres (requis en Next.js 15)
    const { id } = await params;

    // ===== ÉTAPE 1: VÉRIFICATION AUTHENTIFICATION =====
    const session = await checkAuthentication();

    if (!session) {
      // Rediriger vers la page de login si non authentifié
      redirect('/login');
    }

    // ===== ÉTAPE 2: RÉCUPÉRATION DE LA PLATEFORME =====
    const platform = await getPlatformForEditFromDatabase(id);

    // ===== ÉTAPE 3: VÉRIFICATION EXISTENCE =====
    if (!platform) {
      // Plateforme non trouvée ou ID invalide, afficher 404
      notFound();
    }

    // ===== ÉTAPE 4: RENDU DE LA PAGE =====
    logger.info('Platform edit page rendering (Server Component)', {
      platformId: platform.platform_id,
      platformName: platform.platform_name,
      userId: session.user?.id,
      component: 'edit_platform_server_component',
      action: 'page_render',
      timestamp: new Date().toISOString(),
      containsSensitiveData: true,
    });

    return <EditPlatform platform={platform} />;
  } catch (error) {
    // Gestion des erreurs au niveau de la page
    logger.error('Platform edit page error (Server Component)', {
      error: error.message,
      stack: error.stack,
      component: 'edit_platform_server_component',
      action: 'page_error',
    });

    captureException(error, {
      level: 'error',
      tags: {
        component: 'edit_platform_server_component',
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

export default EditPlatformPage;
