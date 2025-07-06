import AddApplication from '@/ui/pages/applications/AddApplication';
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
 * Fonction pour récupérer les templates depuis la base de données
 * Cette fonction remplace l'appel API et s'exécute directement côté serveur
 * @returns {Promise<Array>} Liste des templates ou tableau vide en cas d'erreur
 */
async function getTemplatesFromDatabase() {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();

  logger.info(
    'Templates fetch process started (Add Application Server Component)',
    {
      timestamp: new Date().toISOString(),
      requestId,
      component: 'add_application_server_component',
      action: 'fetch_start',
      method: 'SERVER_COMPONENT',
      context: 'application_creation',
    },
  );

  // Capturer le début du processus de récupération des templates
  captureMessage(
    'Templates fetch process started from Add Application Server Component',
    {
      level: 'info',
      tags: {
        component: 'add_application_server_component',
        action: 'process_start',
        entity: 'template',
        execution_context: 'server_component',
        page_context: 'application_creation',
      },
      extra: {
        requestId,
        timestamp: new Date().toISOString(),
        method: 'SERVER_COMPONENT',
        purpose: 'application_form_data',
      },
    },
  );

  try {
    // ===== ÉTAPE 1: VÉRIFICATION DU CACHE =====
    const cacheKey = getDashboardCacheKey('templates_for_application_add', {
      endpoint: 'add_application_templates',
      version: '1.0',
      context: 'application_creation',
    });

    logger.debug(
      'Checking cache for templates (Add Application Server Component)',
      {
        requestId,
        component: 'add_application_server_component',
        action: 'cache_check_start',
        cacheKey,
        context: 'application_creation',
      },
    );

    // Vérifier si les données sont en cache
    const cachedTemplates = dashboardCache.templates.get(cacheKey);

    if (cachedTemplates) {
      const responseTime = Date.now() - startTime;

      logger.info(
        'Templates served from cache (Add Application Server Component)',
        {
          templateCount: cachedTemplates.length,
          response_time_ms: responseTime,
          cache_hit: true,
          requestId,
          component: 'add_application_server_component',
          action: 'cache_hit',
          entity: 'template',
          context: 'application_creation',
        },
      );

      // Capturer le succès du cache avec Sentry
      captureMessage(
        'Templates served from cache successfully (Add Application Server Component)',
        {
          level: 'info',
          tags: {
            component: 'add_application_server_component',
            action: 'cache_hit',
            success: 'true',
            entity: 'template',
            execution_context: 'server_component',
            page_context: 'application_creation',
          },
          extra: {
            requestId,
            templateCount: cachedTemplates.length,
            responseTimeMs: responseTime,
            cacheKey,
            purpose: 'application_form_data',
          },
        },
      );

      return cachedTemplates;
    }

    logger.debug(
      'Cache miss, fetching from database (Add Application Server Component)',
      {
        requestId,
        component: 'add_application_server_component',
        action: 'cache_miss',
        context: 'application_creation',
      },
    );

    // ===== ÉTAPE 2: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
      logger.debug(
        'Database connection successful (Add Application Server Component)',
        {
          requestId,
          component: 'add_application_server_component',
          action: 'db_connection_success',
          context: 'application_creation',
        },
      );
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error(
        'Database Connection Error during templates fetch (Add Application Server Component)',
        {
          category: errorCategory,
          message: dbConnectionError.message,
          timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
          requestId,
          component: 'add_application_server_component',
          action: 'db_connection_failed',
          context: 'application_creation',
        },
      );

      // Capturer l'erreur de connexion DB avec Sentry
      captureDatabaseError(dbConnectionError, {
        tags: {
          component: 'add_application_server_component',
          action: 'db_connection_failed',
          operation: 'connection',
          entity: 'template',
          execution_context: 'server_component',
          page_context: 'application_creation',
        },
        extra: {
          requestId,
          timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
          purpose: 'application_form_data',
        },
      });

      // Retourner un tableau vide plutôt que de faire planter la page
      return [];
    }

    // ===== ÉTAPE 3: EXÉCUTION DE LA REQUÊTE =====
    let result;
    try {
      // Requête spécialement optimisée pour le formulaire d'ajout d'application
      // On récupère seulement les templates actifs avec les informations nécessaires
      const templatesQuery = `
        SELECT 
          template_id, 
          template_name, 
          template_image, 
          template_has_web, 
          template_has_mobile,
          template_added,
          is_active
        FROM catalog.templates 
        WHERE is_active = true
        ORDER BY template_name ASC, template_added DESC
      `;

      logger.debug(
        'Executing templates query (Add Application Server Component)',
        {
          requestId,
          component: 'add_application_server_component',
          action: 'query_start',
          table: 'catalog.templates',
          operation: 'SELECT',
          context: 'application_creation',
          queryType: 'active_templates_for_form',
        },
      );

      result = await client.query(templatesQuery);

      logger.debug(
        'Templates query executed successfully (Add Application Server Component)',
        {
          requestId,
          component: 'add_application_server_component',
          action: 'query_success',
          rowCount: result.rows.length,
          table: 'catalog.templates',
          context: 'application_creation',
          queryType: 'active_templates_for_form',
        },
      );
    } catch (queryError) {
      const errorCategory = categorizeError(queryError);

      logger.error('Templates Query Error (Add Application Server Component)', {
        category: errorCategory,
        message: queryError.message,
        query: 'active_templates_for_application_form',
        table: 'catalog.templates',
        requestId,
        component: 'add_application_server_component',
        action: 'query_failed',
        context: 'application_creation',
      });

      // Capturer l'erreur de requête avec Sentry
      captureDatabaseError(queryError, {
        tags: {
          component: 'add_application_server_component',
          action: 'query_failed',
          operation: 'SELECT',
          entity: 'template',
          execution_context: 'server_component',
          page_context: 'application_creation',
        },
        extra: {
          requestId,
          table: 'catalog.templates',
          queryType: 'active_templates_for_application_form',
          postgresCode: queryError.code,
          postgresDetail: queryError.detail ? '[Filtered]' : undefined,
          purpose: 'application_form_data',
        },
      });

      if (client) await client.cleanup();
      return []; // Retourner un tableau vide plutôt que de faire planter la page
    }

    // ===== ÉTAPE 4: VALIDATION DES DONNÉES =====
    if (!result || !Array.isArray(result.rows)) {
      logger.warn(
        'Templates query returned invalid data structure (Add Application Server Component)',
        {
          requestId,
          component: 'add_application_server_component',
          action: 'invalid_data_structure',
          resultType: typeof result,
          hasRows: !!result?.rows,
          isArray: Array.isArray(result?.rows),
          context: 'application_creation',
        },
      );

      captureMessage(
        'Templates query returned invalid data structure (Add Application Server Component)',
        {
          level: 'warning',
          tags: {
            component: 'add_application_server_component',
            action: 'invalid_data_structure',
            error_category: 'business_logic',
            entity: 'template',
            execution_context: 'server_component',
            page_context: 'application_creation',
          },
          extra: {
            requestId,
            resultType: typeof result,
            hasRows: !!result?.rows,
            isArray: Array.isArray(result?.rows),
            purpose: 'application_form_data',
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
      template_has_web: Boolean(template.template_has_web),
      template_has_mobile: Boolean(template.template_has_mobile),
      template_added: template.template_added,
      is_active: Boolean(template.is_active),
    }));

    logger.debug(
      'Templates data sanitized (Add Application Server Component)',
      {
        requestId,
        component: 'add_application_server_component',
        action: 'data_sanitization',
        originalCount: result.rows.length,
        sanitizedCount: sanitizedTemplates.length,
        context: 'application_creation',
        activeTemplatesOnly: true,
      },
    );

    // ===== ÉTAPE 6: VALIDATION MÉTIER POUR FORMULAIRE D'APPLICATION =====
    const validTemplatesForApplications = sanitizedTemplates.filter(
      (template) => {
        // S'assurer que chaque template a au moins une plateforme supportée
        return template.template_has_web || template.template_has_mobile;
      },
    );

    if (validTemplatesForApplications.length !== sanitizedTemplates.length) {
      logger.warn(
        'Some templates filtered out due to platform support requirements',
        {
          requestId,
          component: 'add_application_server_component',
          action: 'template_filtering',
          originalCount: sanitizedTemplates.length,
          filteredCount: validTemplatesForApplications.length,
          context: 'application_creation',
        },
      );
    }

    // ===== ÉTAPE 7: MISE EN CACHE DES DONNÉES =====
    logger.debug('Caching templates data (Add Application Server Component)', {
      requestId,
      component: 'add_application_server_component',
      action: 'cache_set_start',
      templateCount: validTemplatesForApplications.length,
      context: 'application_creation',
    });

    // Mettre les données en cache avec une durée spécifique pour les formulaires
    const cacheSuccess = dashboardCache.templates.set(
      cacheKey,
      validTemplatesForApplications,
      { ttl: 10 * 60 * 1000 }, // 10 minutes pour les données de formulaire
    );

    if (cacheSuccess) {
      logger.debug(
        'Templates data cached successfully (Add Application Server Component)',
        {
          requestId,
          component: 'add_application_server_component',
          action: 'cache_set_success',
          cacheKey,
          context: 'application_creation',
        },
      );
    } else {
      logger.warn(
        'Failed to cache templates data (Add Application Server Component)',
        {
          requestId,
          component: 'add_application_server_component',
          action: 'cache_set_failed',
          cacheKey,
          context: 'application_creation',
        },
      );
    }

    // ===== ÉTAPE 8: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info(
      'Templates fetch successful (Add Application Server Component)',
      {
        templateCount: validTemplatesForApplications.length,
        response_time_ms: responseTime,
        database_operations: 2, // connection + query
        success: true,
        requestId,
        component: 'add_application_server_component',
        action: 'fetch_success',
        entity: 'template',
        cacheMiss: true,
        cacheSet: cacheSuccess,
        execution_context: 'server_component',
        context: 'application_creation',
        activeTemplatesOnly: true,
        platformFiltered: true,
      },
    );

    // Capturer le succès de la récupération avec Sentry
    captureMessage(
      'Templates fetch completed successfully (Add Application Server Component)',
      {
        level: 'info',
        tags: {
          component: 'add_application_server_component',
          action: 'fetch_success',
          success: 'true',
          entity: 'template',
          execution_context: 'server_component',
          page_context: 'application_creation',
        },
        extra: {
          requestId,
          templateCount: validTemplatesForApplications.length,
          responseTimeMs: responseTime,
          databaseOperations: 2,
          cacheMiss: true,
          cacheSet: cacheSuccess,
          purpose: 'application_form_data',
          activeTemplatesOnly: true,
          platformFiltered: true,
        },
      },
    );

    if (client) await client.cleanup();

    return validTemplatesForApplications;
  } catch (error) {
    // ===== GESTION GLOBALE DES ERREURS =====
    const errorCategory = categorizeError(error);
    const responseTime = Date.now() - startTime;

    logger.error('Global Templates Error (Add Application Server Component)', {
      category: errorCategory,
      response_time_ms: responseTime,
      reached_global_handler: true,
      error_name: error.name,
      error_message: error.message,
      stack_available: !!error.stack,
      requestId,
      component: 'add_application_server_component',
      action: 'global_error_handler',
      entity: 'template',
      execution_context: 'server_component',
      context: 'application_creation',
    });

    // Capturer l'erreur globale avec Sentry
    captureException(error, {
      level: 'error',
      tags: {
        component: 'add_application_server_component',
        action: 'global_error_handler',
        error_category: errorCategory,
        critical: 'true',
        entity: 'template',
        execution_context: 'server_component',
        page_context: 'application_creation',
      },
      extra: {
        requestId,
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'templates_fetch_for_application_creation',
        purpose: 'application_form_data',
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
      logger.warn('Unauthenticated access attempt to add application page', {
        component: 'add_application_server_component',
        action: 'auth_check_failed',
        timestamp: new Date().toISOString(),
        page: 'add_application',
      });

      // Capturer la tentative d'accès non authentifiée
      captureMessage('Unauthenticated access attempt to add application page', {
        level: 'warning',
        tags: {
          component: 'add_application_server_component',
          action: 'auth_check_failed',
          error_category: 'authentication',
          page_context: 'application_creation',
        },
        extra: {
          timestamp: new Date().toISOString(),
          page: 'add_application',
          attemptedAction: 'access_application_creation_form',
        },
      });

      return null;
    }

    logger.debug(
      'User authentication verified successfully (Add Application Server Component)',
      {
        userId: session.user?.id,
        email: session.user?.email?.substring(0, 3) + '***',
        component: 'add_application_server_component',
        action: 'auth_verification_success',
        page: 'add_application',
      },
    );

    return session;
  } catch (error) {
    logger.error(
      'Authentication check error (Add Application Server Component)',
      {
        error: error.message,
        component: 'add_application_server_component',
        action: 'auth_check_error',
        page: 'add_application',
      },
    );

    captureException(error, {
      level: 'error',
      tags: {
        component: 'add_application_server_component',
        action: 'auth_check_error',
        error_category: 'authentication',
        page_context: 'application_creation',
      },
      extra: {
        errorMessage: error.message,
        page: 'add_application',
      },
    });

    return null;
  }
}

/**
 * Server Component principal pour la page d'ajout d'application
 * Cette fonction s'exécute côté serveur et récupère les templates directement depuis la DB
 */
const AddApplicationPage = async () => {
  try {
    // ===== ÉTAPE 1: VÉRIFICATION AUTHENTIFICATION =====
    const session = await checkAuthentication();

    if (!session) {
      // Rediriger vers la page de login si non authentifié
      redirect('/login');
    }

    // ===== ÉTAPE 2: RÉCUPÉRATION DES TEMPLATES POUR LE FORMULAIRE =====
    const templates = await getTemplatesFromDatabase();

    // ===== ÉTAPE 3: VALIDATION DES DONNÉES RÉCUPÉRÉES =====
    if (!Array.isArray(templates)) {
      logger.error('Invalid templates data structure for application form', {
        templatesType: typeof templates,
        component: 'add_application_server_component',
        action: 'data_validation_failed',
        userId: session.user?.id,
      });

      // En cas de données invalides, passer un tableau vide
      return <AddApplication templates={[]} />;
    }

    // ===== ÉTAPE 4: LOG ET MÉTRIQUES =====
    logger.info('Add Application page rendering (Server Component)', {
      templateCount: templates.length,
      userId: session.user?.id,
      component: 'add_application_server_component',
      action: 'page_render',
      timestamp: new Date().toISOString(),
      hasTemplates: templates.length > 0,
      webTemplatesCount: templates.filter((t) => t.template_has_web).length,
      mobileTemplatesCount: templates.filter((t) => t.template_has_mobile)
        .length,
    });

    // Capturer les métriques de rendu de page
    captureMessage('Add Application page rendered successfully', {
      level: 'info',
      tags: {
        component: 'add_application_server_component',
        action: 'page_render_success',
        page_context: 'application_creation',
        success: 'true',
      },
      extra: {
        templateCount: templates.length,
        userId: session.user?.id,
        hasTemplates: templates.length > 0,
        webTemplatesCount: templates.filter((t) => t.template_has_web).length,
        mobileTemplatesCount: templates.filter((t) => t.template_has_mobile)
          .length,
        timestamp: new Date().toISOString(),
      },
    });

    // ===== ÉTAPE 5: RENDU DE LA PAGE =====
    return <AddApplication templates={templates} />;
  } catch (error) {
    // Gestion des erreurs au niveau de la page
    logger.error('Add Application page error (Server Component)', {
      error: error.message,
      stack: error.stack,
      component: 'add_application_server_component',
      action: 'page_error',
      page: 'add_application',
    });

    captureException(error, {
      level: 'error',
      tags: {
        component: 'add_application_server_component',
        action: 'page_error',
        error_category: 'page_rendering',
        critical: 'true',
        page_context: 'application_creation',
      },
      extra: {
        errorMessage: error.message,
        stackAvailable: !!error.stack,
        page: 'add_application',
        attemptedAction: 'render_application_creation_form',
      },
    });

    // En cas d'erreur critique, afficher une page avec des données vides
    // plutôt que de faire planter complètement l'application
    return <AddApplication templates={[]} />;
  }
};

export default AddApplicationPage;
