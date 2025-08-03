import EditPlatform from '@ui/pages/platforms/EditPlatform';
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
 * ✅ MISE À JOUR: Utilise la nouvelle architecture Sentry
 * @param {string} platformId - L'ID de la plateforme à récupérer
 * @returns {Promise<Object|null>} Plateforme ou null si non trouvée/erreur
 */
async function getPlatformForEditFromDatabase(platformId) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();

  logger.info('Platform for edit fetch process started', {
    requestId,
    platformId,
  });

  // ✅ NOUVEAU: Utilisation des fonctions Sentry adaptées
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
    try {
      // Valider l'ID avec le schema Yup
      await platformIdSchema.validate(
        { id: platformId },
        { abortEarly: false },
      );
    } catch (validationError) {
      const errorCategory = categorizeError(validationError);

      logger.warn('Platform ID validation failed with Yup', {
        category: errorCategory,
        providedId: platformId,
        failed_fields: validationError.inner?.map((err) => err.path) || [],
        requestId,
      });

      // ✅ NOUVEAU: captureMessage pour les problèmes de validation
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
      logger.warn('Platform ID cleaning failed', {
        requestId,
        providedId: platformId,
      });

      return null;
    }

    // ===== ÉTAPE 2: VÉRIFICATION DU CACHE =====
    const cacheKey = getDashboardCacheKey('edit_platform', {
      endpoint: 'server_component_platform_edit',
      platformId: cleanedPlatformId,
      version: '1.0',
    });

    // Vérifier si les données sont en cache
    const cachedPlatform = dashboardCache.platforms.get(cacheKey);

    if (cachedPlatform) {
      const responseTime = Date.now() - startTime;

      logger.info('Platform for edit served from cache', {
        platformId: cleanedPlatformId,
        platformName: cachedPlatform.platform_name,
        response_time_ms: responseTime,
        requestId,
      });

      // ✅ NOUVEAU: captureMessage adapté pour Server Components
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

    // ===== ÉTAPE 3: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Database Connection Error during platform fetch for edit', {
        category: errorCategory,
        message: dbConnectionError.message,
        requestId,
        platformId: cleanedPlatformId,
      });

      // ✅ NOUVEAU: captureDatabaseError adapté pour Server Components
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

      result = await client.query(platformQuery, [cleanedPlatformId]);
    } catch (queryError) {
      const errorCategory = categorizeError(queryError);

      logger.error('Platform Fetch For Edit Query Error', {
        category: errorCategory,
        message: queryError.message,
        platformId: cleanedPlatformId,
        requestId,
      });

      // ✅ NOUVEAU: captureDatabaseError avec contexte spécifique
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
      logger.warn('Platform not found for edit', {
        requestId,
        platformId: cleanedPlatformId,
      });

      // ✅ NOUVEAU: captureMessage pour les problèmes de logique métier
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

    // ===== ÉTAPE 7: MISE EN CACHE DES DONNÉES =====
    // Mettre les données en cache
    const cacheSuccess = dashboardCache.platforms.set(
      cacheKey,
      sanitizedPlatform,
    );

    if (!cacheSuccess) {
      logger.warn('Failed to cache platform edit data', {
        requestId,
        platformId: cleanedPlatformId,
      });
    }

    // ===== ÉTAPE 8: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Platform fetch for edit successful', {
      platformId: cleanedPlatformId,
      platformName: sanitizedPlatform.platform_name,
      response_time_ms: responseTime,
      requestId,
    });

    // ✅ NOUVEAU: captureMessage de succès
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

    logger.error('Global Platform For Edit Error', {
      category: errorCategory,
      response_time_ms: responseTime,
      error_message: error.message,
      requestId,
      platformId,
    });

    // ✅ NOUVEAU: captureException adapté pour Server Components
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
 * ✅ MISE À JOUR: Utilise la nouvelle architecture Sentry
 * @returns {Promise<Object|null>} Session utilisateur ou null si non authentifié
 */
async function checkAuthentication() {
  try {
    const session = await getServerSession(auth);

    if (!session) {
      logger.warn('Unauthenticated access attempt to platform edit page');

      // ✅ NOUVEAU: captureMessage pour tentative d'accès non authentifiée
      captureMessage('Unauthenticated access attempt to platform edit page', {
        level: 'warning',
        tags: {
          component: 'edit_platform_server_component',
          action: 'auth_check_failed',
          error_category: 'authentication',
          execution_context: 'server_component',
        },
        extra: {
          timestamp: new Date().toISOString(),
          page: 'platform_edit',
        },
      });

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
        component: 'edit_platform_server_component',
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
 * Server Component principal pour la page d'édition d'une plateforme
 * ✅ NOUVEAU: Wrappé avec monitoring automatique
 */
const EditPlatformPageComponent = async ({ params }) => {
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
    logger.info('Platform edit page rendering', {
      platformId: platform.platform_id,
      platformName: platform.platform_name,
      userId: session.user?.id,
    });

    return <EditPlatform platform={platform} />;
  } catch (error) {
    // Gestion des erreurs au niveau de la page
    logger.error('Platform edit page error', {
      error: error.message,
    });

    // ✅ NOUVEAU: captureServerComponentError pour erreurs de rendu
    captureServerComponentError(error, {
      componentName: 'EditPlatformPage',
      route: '/dashboard/platforms/edit/[id]',
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
const EditPlatformPage = withServerComponentMonitoring(
  EditPlatformPageComponent,
  'EditPlatformPage',
);

export default EditPlatformPage;
