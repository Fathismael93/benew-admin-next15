import ListTemplates from '@/ui/pages/templates/ListTemplates';
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
 * Fonction pour récupérer les templates depuis la base de données
 * ✅ MISE À JOUR: Utilise la nouvelle architecture Sentry
 * @returns {Promise<Array>} Liste des templates ou tableau vide en cas d'erreur
 */
async function getTemplatesFromDatabase() {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();

  logger.info('Templates fetch process started (Server Component)', {
    timestamp: new Date().toISOString(),
    requestId,
    component: 'templates_server_component',
    action: 'fetch_start',
    method: 'SERVER_COMPONENT',
  });

  // ✅ NOUVEAU: Utilisation des fonctions Sentry adaptées
  captureMessage('Templates fetch process started from Server Component', {
    level: 'info',
    tags: {
      component: 'templates_server_component',
      action: 'process_start',
      entity: 'template',
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
    const cacheKey = getDashboardCacheKey('templates_list', {
      endpoint: 'server_component_templates',
      version: '1.0',
    });

    logger.debug('Checking cache for templates (Server Component)', {
      requestId,
      component: 'templates_server_component',
      action: 'cache_check_start',
      cacheKey,
    });

    // Vérifier si les données sont en cache
    const cachedTemplates = dashboardCache.templates.get(cacheKey);

    if (cachedTemplates) {
      const responseTime = Date.now() - startTime;

      logger.info('Templates served from cache (Server Component)', {
        templateCount: cachedTemplates.length,
        response_time_ms: responseTime,
        cache_hit: true,
        requestId,
        component: 'templates_server_component',
        action: 'cache_hit',
        entity: 'template',
      });

      // ✅ NOUVEAU: captureMessage adapté pour Server Components
      captureMessage(
        'Templates served from cache successfully (Server Component)',
        {
          level: 'info',
          tags: {
            component: 'templates_server_component',
            action: 'cache_hit',
            success: 'true',
            entity: 'template',
            execution_context: 'server_component',
          },
          extra: {
            requestId,
            templateCount: cachedTemplates.length,
            responseTimeMs: responseTime,
            cacheKey,
          },
        },
      );

      return cachedTemplates;
    }

    logger.debug('Cache miss, fetching from database (Server Component)', {
      requestId,
      component: 'templates_server_component',
      action: 'cache_miss',
    });

    // ===== ÉTAPE 2: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
      logger.debug('Database connection successful (Server Component)', {
        requestId,
        component: 'templates_server_component',
        action: 'db_connection_success',
      });
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error(
        'Database Connection Error during templates fetch (Server Component)',
        {
          category: errorCategory,
          message: dbConnectionError.message,
          timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
          requestId,
          component: 'templates_server_component',
          action: 'db_connection_failed',
        },
      );

      // ✅ NOUVEAU: captureDatabaseError adapté pour Server Components
      captureDatabaseError(dbConnectionError, {
        tags: {
          component: 'templates_server_component',
          action: 'db_connection_failed',
          operation: 'connection',
          entity: 'template',
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
      const templatesQuery = `
  SELECT 
    template_id, 
    template_name, 
    template_image, 
    template_color,
    template_has_web, 
    template_has_mobile, 
    template_added, 
    sales_count, 
    is_active, 
    updated_at 
  FROM catalog.templates 
  ORDER BY template_added DESC
`;

      logger.debug('Executing templates query (Server Component)', {
        requestId,
        component: 'templates_server_component',
        action: 'query_start',
        table: 'catalog.templates',
        operation: 'SELECT',
      });

      result = await client.query(templatesQuery);

      logger.debug('Templates query executed successfully (Server Component)', {
        requestId,
        component: 'templates_server_component',
        action: 'query_success',
        rowCount: result.rows.length,
        table: 'catalog.templates',
      });
    } catch (queryError) {
      const errorCategory = categorizeError(queryError);

      logger.error('Templates Query Error (Server Component)', {
        category: errorCategory,
        message: queryError.message,
        query: 'templates_fetch',
        table: 'catalog.templates',
        requestId,
        component: 'templates_server_component',
        action: 'query_failed',
      });

      // ✅ NOUVEAU: captureDatabaseError avec contexte spécifique
      captureDatabaseError(queryError, {
        tags: {
          component: 'templates_server_component',
          action: 'query_failed',
          operation: 'SELECT',
          entity: 'template',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          table: 'catalog.templates',
          queryType: 'templates_fetch',
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
        'Templates query returned invalid data structure (Server Component)',
        {
          requestId,
          component: 'templates_server_component',
          action: 'invalid_data_structure',
          resultType: typeof result,
          hasRows: !!result?.rows,
          isArray: Array.isArray(result?.rows),
        },
      );

      // ✅ NOUVEAU: captureMessage pour les problèmes de structure de données
      captureMessage(
        'Templates query returned invalid data structure (Server Component)',
        {
          level: 'warning',
          tags: {
            component: 'templates_server_component',
            action: 'invalid_data_structure',
            error_category: 'business_logic',
            entity: 'template',
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
    const sanitizedTemplates = result.rows.map((template) => ({
      template_id: template.template_id,
      template_name: template.template_name || '[No Name]',
      template_image: template.template_image,
      template_color: template.template_color || null,
      template_has_web: Boolean(template.template_has_web),
      template_has_mobile: Boolean(template.template_has_mobile),
      template_added: template.template_added,
      sales_count: parseInt(template.sales_count) || 0,
      is_active: Boolean(template.is_active),
      updated_at: template.updated_at,
    }));

    logger.debug('Templates data sanitized (Server Component)', {
      requestId,
      component: 'templates_server_component',
      action: 'data_sanitization',
      originalCount: result.rows.length,
      sanitizedCount: sanitizedTemplates.length,
    });

    // ===== ÉTAPE 6: MISE EN CACHE DES DONNÉES =====
    logger.debug('Caching templates data (Server Component)', {
      requestId,
      component: 'templates_server_component',
      action: 'cache_set_start',
      templateCount: sanitizedTemplates.length,
    });

    // Mettre les données en cache
    const cacheSuccess = dashboardCache.templates.set(
      cacheKey,
      sanitizedTemplates,
    );

    if (cacheSuccess) {
      logger.debug('Templates data cached successfully (Server Component)', {
        requestId,
        component: 'templates_server_component',
        action: 'cache_set_success',
        cacheKey,
      });
    } else {
      logger.warn('Failed to cache templates data (Server Component)', {
        requestId,
        component: 'templates_server_component',
        action: 'cache_set_failed',
        cacheKey,
      });
    }

    // ===== ÉTAPE 7: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Templates fetch successful (Server Component)', {
      templateCount: sanitizedTemplates.length,
      response_time_ms: responseTime,
      database_operations: 2, // connection + query
      success: true,
      requestId,
      component: 'templates_server_component',
      action: 'fetch_success',
      entity: 'template',
      cacheMiss: true,
      cacheSet: cacheSuccess,
      execution_context: 'server_component',
    });

    // ✅ NOUVEAU: captureMessage de succès
    captureMessage(
      'Templates fetch completed successfully (Server Component)',
      {
        level: 'info',
        tags: {
          component: 'templates_server_component',
          action: 'fetch_success',
          success: 'true',
          entity: 'template',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          templateCount: sanitizedTemplates.length,
          responseTimeMs: responseTime,
          databaseOperations: 2,
          cacheMiss: true,
          cacheSet: cacheSuccess,
        },
      },
    );

    if (client) await client.cleanup();

    return sanitizedTemplates;
  } catch (error) {
    // ===== GESTION GLOBALE DES ERREURS =====
    const errorCategory = categorizeError(error);
    const responseTime = Date.now() - startTime;

    logger.error('Global Templates Error (Server Component)', {
      category: errorCategory,
      response_time_ms: responseTime,
      reached_global_handler: true,
      error_name: error.name,
      error_message: error.message,
      stack_available: !!error.stack,
      requestId,
      component: 'templates_server_component',
      action: 'global_error_handler',
      entity: 'template',
      execution_context: 'server_component',
    });

    // ✅ NOUVEAU: captureException adapté pour Server Components
    captureException(error, {
      level: 'error',
      tags: {
        component: 'templates_server_component',
        action: 'global_error_handler',
        error_category: errorCategory,
        critical: 'true',
        entity: 'template',
        execution_context: 'server_component',
      },
      extra: {
        requestId,
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'templates_fetch_server_component',
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
      logger.warn('Unauthenticated access attempt to templates page', {
        component: 'templates_server_component',
        action: 'auth_check_failed',
        timestamp: new Date().toISOString(),
      });

      // ✅ NOUVEAU: captureMessage pour tentative d'accès non authentifiée
      captureMessage('Unauthenticated access attempt to templates page', {
        level: 'warning',
        tags: {
          component: 'templates_server_component',
          action: 'auth_check_failed',
          error_category: 'authentication',
          execution_context: 'server_component',
        },
        extra: {
          timestamp: new Date().toISOString(),
          page: 'templates',
        },
      });

      return null;
    }

    logger.debug(
      'User authentication verified successfully (Server Component)',
      {
        userId: session.user?.id,
        email: session.user?.email?.substring(0, 3) + '***',
        component: 'templates_server_component',
        action: 'auth_verification_success',
      },
    );

    return session;
  } catch (error) {
    logger.error('Authentication check error (Server Component)', {
      error: error.message,
      component: 'templates_server_component',
      action: 'auth_check_error',
    });

    // ✅ NOUVEAU: captureException pour erreurs d'authentification
    captureException(error, {
      level: 'error',
      tags: {
        component: 'templates_server_component',
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
 * Server Component principal pour la page des templates
 * ✅ NOUVEAU: Wrappé avec monitoring automatique
 */
const TemplatesPageComponent = async () => {
  try {
    // ===== ÉTAPE 1: VÉRIFICATION AUTHENTIFICATION =====
    const session = await checkAuthentication();

    if (!session) {
      // Rediriger vers la page de login si non authentifié
      redirect('/login');
    }

    // ===== ÉTAPE 2: RÉCUPÉRATION DES TEMPLATES =====
    const templates = await getTemplatesFromDatabase();

    // ===== ÉTAPE 3: RENDU DE LA PAGE =====
    logger.info('Templates page rendering (Server Component)', {
      templateCount: templates.length,
      userId: session.user?.id,
      component: 'templates_server_component',
      action: 'page_render',
      timestamp: new Date().toISOString(),
    });

    return <ListTemplates data={templates} />;
  } catch (error) {
    // Gestion des erreurs au niveau de la page
    logger.error('Templates page error (Server Component)', {
      error: error.message,
      stack: error.stack,
      component: 'templates_server_component',
      action: 'page_error',
    });

    // ✅ NOUVEAU: captureServerComponentError pour erreurs de rendu
    captureServerComponentError(error, {
      componentName: 'TemplatesPage',
      route: '/dashboard/templates',
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
    return <ListTemplates data={[]} />;
  }
};

// ✅ NOUVEAU: Export du composant avec monitoring automatique
const TemplatesPage = withServerComponentMonitoring(
  TemplatesPageComponent,
  'TemplatesPage',
);

export default TemplatesPage;
