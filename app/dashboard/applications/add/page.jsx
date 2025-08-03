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
import { categorizeError, generateRequestId } from '@/utils/helpers';
import logger from '@/utils/logger';
import { dashboardCache, getDashboardCacheKey } from '@/utils/cache';

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
      requestId,
    },
  );

  try {
    // ===== ÉTAPE 1: VÉRIFICATION DU CACHE =====
    const cacheKey = getDashboardCacheKey('templates_for_application_add', {
      endpoint: 'add_application_templates',
      version: '1.0',
      context: 'application_creation',
    });

    const cachedTemplates = dashboardCache.templates.get(cacheKey);

    if (cachedTemplates) {
      const responseTime = Date.now() - startTime;

      logger.info(
        'Templates served from cache (Add Application Server Component)',
        {
          templateCount: cachedTemplates.length,
          response_time_ms: responseTime,
          requestId,
        },
      );

      return cachedTemplates;
    }

    // ===== ÉTAPE 2: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error(
        'Database Connection Error during templates fetch (Add Application Server Component)',
        {
          category: errorCategory,
          message: dbConnectionError.message,
          requestId,
        },
      );

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
        },
      });

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
          template_has_web, 
          template_has_mobile,
          template_added,
          is_active
        FROM catalog.templates 
        WHERE is_active = true
        ORDER BY template_name ASC, template_added DESC
      `;

      result = await client.query(templatesQuery);
    } catch (queryError) {
      const errorCategory = categorizeError(queryError);

      logger.error('Templates Query Error (Add Application Server Component)', {
        category: errorCategory,
        message: queryError.message,
        requestId,
      });

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
        },
      });

      if (client) await client.cleanup();
      return [];
    }

    // ===== ÉTAPE 4: VALIDATION DES DONNÉES =====
    if (!result || !Array.isArray(result.rows)) {
      logger.warn(
        'Templates query returned invalid data structure (Add Application Server Component)',
        {
          requestId,
          resultType: typeof result,
        },
      );

      if (client) await client.cleanup();
      return [];
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

    // ===== ÉTAPE 6: VALIDATION MÉTIER POUR FORMULAIRE D'APPLICATION =====
    const validTemplatesForApplications = sanitizedTemplates.filter(
      (template) => {
        return template.template_has_web || template.template_has_mobile;
      },
    );

    if (validTemplatesForApplications.length !== sanitizedTemplates.length) {
      logger.warn(
        'Some templates filtered out due to platform support requirements',
        {
          requestId,
          originalCount: sanitizedTemplates.length,
          filteredCount: validTemplatesForApplications.length,
        },
      );
    }

    // ===== ÉTAPE 7: MISE EN CACHE DES DONNÉES =====
    const cacheSuccess = dashboardCache.templates.set(
      cacheKey,
      validTemplatesForApplications,
      { ttl: 10 * 60 * 1000 }, // 10 minutes pour les données de formulaire
    );

    // ===== ÉTAPE 8: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info(
      'Templates fetch successful (Add Application Server Component)',
      {
        templateCount: validTemplatesForApplications.length,
        response_time_ms: responseTime,
        requestId,
      },
    );

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
      error_message: error.message,
      requestId,
    });

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
        process: 'templates_fetch_for_application_creation',
      },
    });

    if (client) await client.cleanup();

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
      logger.warn('Unauthenticated access attempt to add application page');

      captureMessage('Unauthenticated access attempt to add application page', {
        level: 'warning',
        tags: {
          component: 'add_application_server_component',
          action: 'auth_check_failed',
          error_category: 'authentication',
          page_context: 'application_creation',
        },
        extra: {
          page: 'add_application',
        },
      });

      return null;
    }

    return session;
  } catch (error) {
    logger.error(
      'Authentication check error (Add Application Server Component)',
      {
        error: error.message,
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
      redirect('/login');
    }

    // ===== ÉTAPE 2: RÉCUPÉRATION DES TEMPLATES POUR LE FORMULAIRE =====
    const templates = await getTemplatesFromDatabase();

    // ===== ÉTAPE 3: VALIDATION DES DONNÉES RÉCUPÉRÉES =====
    if (!Array.isArray(templates)) {
      logger.error('Invalid templates data structure for application form', {
        templatesType: typeof templates,
        userId: session.user?.id,
      });

      return <AddApplication templates={[]} />;
    }

    // ===== ÉTAPE 4: LOG ET MÉTRIQUES =====
    logger.info('Add Application page rendering (Server Component)', {
      templateCount: templates.length,
      userId: session.user?.id,
    });

    // ===== ÉTAPE 5: RENDU DE LA PAGE =====
    return <AddApplication templates={templates} />;
  } catch (error) {
    logger.error('Add Application page error (Server Component)', {
      error: error.message,
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
    });

    return <AddApplication templates={[]} />;
  }
};

export default AddApplicationPage;
