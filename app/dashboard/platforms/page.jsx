// app/dashboard/platforms/page.jsx (Server Component)

import PlatformsList from '@/ui/pages/platforms/PlatformsList';
import { getServerSession } from 'next-auth';
import { auth } from '@app/api/auth/[...nextauth]/route';
import { getClient } from '@backend/dbConnect';
import { redirect } from 'next/navigation';
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
  dashboardCache,
  getDashboardCacheKey,
  cacheEvents,
} from '@/utils/cache';

// Configuration de revalidation pour cette page
export const revalidate = 0; // Désactive le cache statique
export const dynamic = 'force-dynamic'; // Force le rendu dynamique

/**
 * Fonction pour récupérer les plateformes depuis la base de données
 * ✅ MISE À JOUR: Utilise la nouvelle architecture Sentry
 * @returns {Promise<Array>} Liste des plateformes ou tableau vide en cas d'erreur
 */
async function getPlatformsFromDatabase() {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();

  logger.info('Platforms fetch process started', {
    requestId,
  });

  // ✅ NOUVEAU: Utilisation des fonctions Sentry adaptées
  captureMessage('Platforms fetch process started from Server Component', {
    level: 'info',
    tags: {
      component: 'platforms_server_component',
      action: 'process_start',
      entity: 'platform',
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
    const cacheKey = getDashboardCacheKey('platforms_list', {
      endpoint: 'server_component_platforms',
      version: '1.0',
    });

    // Vérifier si les données sont en cache
    const cachedPlatforms = dashboardCache.platforms.get(cacheKey);

    if (cachedPlatforms) {
      const responseTime = Date.now() - startTime;

      logger.info('Platforms served from cache', {
        platformCount: cachedPlatforms.length,
        response_time_ms: responseTime,
        requestId,
      });

      // ✅ NOUVEAU: captureMessage adapté pour Server Components
      captureMessage(
        'Platforms served from cache successfully (Server Component)',
        {
          level: 'info',
          tags: {
            component: 'platforms_server_component',
            action: 'cache_hit',
            success: 'true',
            entity: 'platform',
            execution_context: 'server_component',
          },
          extra: {
            requestId,
            platformCount: cachedPlatforms.length,
            responseTimeMs: responseTime,
            cacheKey,
          },
        },
      );

      // Émettre un événement de cache hit
      cacheEvents.emit('dashboard_hit', {
        key: cacheKey,
        cache: dashboardCache.platforms,
        entityType: 'platform',
        requestId,
        context: 'server_component',
      });

      return cachedPlatforms;
    }

    // ===== ÉTAPE 2: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Database Connection Error during platforms fetch', {
        category: errorCategory,
        message: dbConnectionError.message,
        requestId,
      });

      // ✅ NOUVEAU: captureDatabaseError adapté pour Server Components
      captureDatabaseError(dbConnectionError, {
        tags: {
          component: 'platforms_server_component',
          action: 'db_connection_failed',
          operation: 'connection',
          entity: 'platform',
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

    // ===== ÉTAPE 3: EXÉCUTION DE LA REQUÊTE =====
    let result;
    try {
      const platformsQuery = `
        SELECT 
          platform_id, 
          platform_name, 
          platform_number, 
          created_at, 
          updated_at, 
          is_active
        FROM admin.platforms 
        ORDER BY created_at DESC
      `;

      result = await client.query(platformsQuery);
    } catch (queryError) {
      const errorCategory = categorizeError(queryError);

      logger.error('Platforms Query Error', {
        category: errorCategory,
        message: queryError.message,
        requestId,
      });

      // ✅ NOUVEAU: captureDatabaseError avec contexte spécifique
      captureDatabaseError(queryError, {
        tags: {
          component: 'platforms_server_component',
          action: 'query_failed',
          operation: 'SELECT',
          entity: 'platform',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          table: 'admin.platforms',
          queryType: 'platforms_fetch',
          postgresCode: queryError.code,
          postgresDetail: queryError.detail ? '[Filtered]' : undefined,
        },
      });

      if (client) await client.cleanup();
      return []; // Retourner un tableau vide plutôt que de faire planter la page
    }

    // ===== ÉTAPE 4: VALIDATION DES DONNÉES =====
    if (!result || !Array.isArray(result.rows)) {
      logger.warn('Platforms query returned invalid data structure', {
        requestId,
        resultType: typeof result,
      });

      // ✅ NOUVEAU: captureMessage pour les problèmes de structure de données
      captureMessage(
        'Platforms query returned invalid data structure (Server Component)',
        {
          level: 'warning',
          tags: {
            component: 'platforms_server_component',
            action: 'invalid_data_structure',
            error_category: 'business_logic',
            entity: 'platform',
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
    const sanitizedPlatforms = result.rows.map((platform) => ({
      platform_id: platform.platform_id,
      platform_name: platform.platform_name || '[No Name]',
      // Masquer partiellement le numéro pour la sécurité (données bancaires sensibles)
      platform_number: platform.platform_number
        ? `${platform.platform_number.slice(0, 3)}***${platform.platform_number.slice(-2)}`
        : '[No Number]',
      created_at: platform.created_at,
      updated_at: platform.updated_at,
      is_active: Boolean(platform.is_active),
    }));

    // ===== ÉTAPE 6: MISE EN CACHE DES DONNÉES =====
    // Mettre les données en cache (sans les numéros complets pour sécurité)
    const cacheData = sanitizedPlatforms;

    const cacheSuccess = dashboardCache.platforms.set(cacheKey, cacheData);

    if (cacheSuccess) {
      // Émettre un événement de cache set
      cacheEvents.emit('dashboard_set', {
        key: cacheKey,
        cache: dashboardCache.platforms,
        entityType: 'platform',
        requestId,
        size: cacheData.length,
        context: 'server_component',
      });
    } else {
      logger.warn('Failed to cache platforms data', {
        requestId,
      });
    }

    // ===== ÉTAPE 7: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Platforms fetch successful', {
      platformCount: sanitizedPlatforms.length,
      response_time_ms: responseTime,
      requestId,
    });

    // ✅ NOUVEAU: captureMessage de succès
    captureMessage(
      'Platforms fetch completed successfully (Server Component)',
      {
        level: 'info',
        tags: {
          component: 'platforms_server_component',
          action: 'fetch_success',
          success: 'true',
          entity: 'platform',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          platformCount: sanitizedPlatforms.length,
          responseTimeMs: responseTime,
          databaseOperations: 2,
          cacheMiss: true,
          cacheSet: cacheSuccess,
          dataSanitized: true,
        },
      },
    );

    if (client) await client.cleanup();

    // Retourner les données sans les numéros complets (sécurité)
    return cacheData;
  } catch (error) {
    // ===== GESTION GLOBALE DES ERREURS =====
    const errorCategory = categorizeError(error);
    const responseTime = Date.now() - startTime;

    logger.error('Global Platforms Error', {
      category: errorCategory,
      response_time_ms: responseTime,
      error_message: error.message,
      requestId,
    });

    // ✅ NOUVEAU: captureException adapté pour Server Components
    captureException(error, {
      level: 'error',
      tags: {
        component: 'platforms_server_component',
        action: 'global_error_handler',
        error_category: errorCategory,
        critical: 'true',
        entity: 'platform',
        execution_context: 'server_component',
      },
      extra: {
        requestId,
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'platforms_fetch_server_component',
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
 * ✅ MISE À JOUR: Utilise la nouvelle architecture Sentry
 * @returns {Promise<Object|null>} Session utilisateur ou null si non authentifié
 */
async function checkAuthentication() {
  try {
    const session = await getServerSession(auth);

    if (!session) {
      logger.warn('Unauthenticated access attempt to platforms page');

      // ✅ NOUVEAU: captureMessage pour tentative d'accès non authentifiée
      captureMessage('Unauthenticated access attempt to platforms page', {
        level: 'warning',
        tags: {
          component: 'platforms_server_component',
          action: 'auth_check_failed',
          error_category: 'authentication',
          execution_context: 'server_component',
        },
        extra: {
          timestamp: new Date().toISOString(),
          page: 'platforms',
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
        component: 'platforms_server_component',
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
 * Server Component principal pour la page des plateformes
 * ✅ NOUVEAU: Wrappé avec monitoring automatique
 */
const PlatformsPageComponent = async () => {
  try {
    // ===== ÉTAPE 1: VÉRIFICATION AUTHENTIFICATION =====
    const session = await checkAuthentication();

    if (!session) {
      // Rediriger vers la page de login si non authentifié
      redirect('/login');
    }

    // ===== ÉTAPE 2: RÉCUPÉRATION DES PLATEFORMES =====
    const platforms = await getPlatformsFromDatabase();

    // ===== ÉTAPE 3: RENDU DE LA PAGE =====
    logger.info('Platforms page rendering', {
      platformCount: platforms.length,
      userId: session.user?.id,
    });

    return <PlatformsList data={platforms} />;
  } catch (error) {
    // Gestion des erreurs au niveau de la page
    logger.error('Platforms page error', {
      error: error.message,
    });

    // ✅ NOUVEAU: captureServerComponentError pour erreurs de rendu
    captureServerComponentError(error, {
      componentName: 'PlatformsPage',
      route: '/dashboard/platforms',
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
    // plutôt que de faire planter complètement l'application
    return <PlatformsList data={[]} />;
  }
};

// ✅ NOUVEAU: Export du composant avec monitoring automatique
const PlatformsPage = withServerComponentMonitoring(
  PlatformsPageComponent,
  'PlatformsPage',
);

export default PlatformsPage;
