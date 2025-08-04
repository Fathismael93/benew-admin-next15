import EditTemplate from '@/ui/pages/templates/EditTemplate';
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
import { templateIdSchema, cleanUUID } from '@/utils/schemas/templateSchema';
import { dashboardCache, getDashboardCacheKey } from '@/utils/cache';

// Configuration de revalidation pour cette page
export const revalidate = 0; // Désactive le cache statique
export const dynamic = 'force-dynamic'; // Force le rendu dynamique

/**
 * Fonction pour récupérer un template spécifique depuis la base de données
 * ✅ MISE À JOUR: Utilise la nouvelle architecture Sentry
 * @param {string} templateId - L'ID du template à récupérer
 * @returns {Promise<Object|null>} Template ou null si non trouvé/erreur
 */
async function getTemplateFromDatabase(templateId) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();

  logger.info('Template by ID fetch process started', {
    requestId,
    templateId,
  });

  // ✅ NOUVEAU: Utilisation des fonctions Sentry adaptées
  captureMessage('Get template by ID process started from Server Component', {
    level: 'info',
    tags: {
      component: 'template_by_id_server_component',
      action: 'process_start',
      entity: 'template',
      execution_context: 'server_component',
      operation: 'read',
    },
    extra: {
      requestId,
      templateId,
      timestamp: new Date().toISOString(),
      method: 'SERVER_COMPONENT',
    },
  });

  try {
    // ===== ÉTAPE 1: VALIDATION DE L'ID AVEC YUP =====
    try {
      // Valider l'ID avec le schema Yup
      await templateIdSchema.validate(
        { id: templateId },
        { abortEarly: false },
      );
    } catch (validationError) {
      const errorCategory = categorizeError(validationError);

      logger.warn('Template ID validation failed with Yup', {
        category: errorCategory,
        providedId: templateId,
        failed_fields: validationError.inner?.map((err) => err.path) || [],
        requestId,
      });

      // ✅ NOUVEAU: captureMessage pour les problèmes de validation
      captureMessage(
        'Template ID validation failed with Yup schema (Server Component)',
        {
          level: 'warning',
          tags: {
            component: 'template_by_id_server_component',
            action: 'yup_id_validation_failed',
            error_category: 'validation',
            entity: 'template',
            operation: 'read',
            execution_context: 'server_component',
          },
          extra: {
            requestId,
            providedId: templateId,
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
    const cleanedTemplateId = cleanUUID(templateId);
    if (!cleanedTemplateId) {
      logger.warn('Template ID cleaning failed', {
        requestId,
        providedId: templateId,
      });

      return null;
    }

    // ===== ÉTAPE 2: VÉRIFICATION DU CACHE =====
    const cacheKey = getDashboardCacheKey('single_template', {
      endpoint: 'server_component_template_by_id',
      templateId: cleanedTemplateId,
      version: '1.0',
    });

    // Vérifier si les données sont en cache
    const cachedTemplate = dashboardCache.singleTemplate.get(cacheKey);

    if (cachedTemplate) {
      const responseTime = Date.now() - startTime;

      logger.info('Template served from cache', {
        templateId: cleanedTemplateId,
        templateName: cachedTemplate.template_name,
        response_time_ms: responseTime,
        requestId,
      });

      // ✅ NOUVEAU: captureMessage adapté pour Server Components
      captureMessage(
        'Template by ID served from cache successfully (Server Component)',
        {
          level: 'info',
          tags: {
            component: 'template_by_id_server_component',
            action: 'cache_hit',
            success: 'true',
            entity: 'template',
            execution_context: 'server_component',
            operation: 'read',
          },
          extra: {
            requestId,
            templateId: cleanedTemplateId,
            templateName: cachedTemplate.template_name,
            responseTimeMs: responseTime,
            cacheKey,
          },
        },
      );

      return cachedTemplate;
    }

    // ===== ÉTAPE 3: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Database Connection Error during template fetch by ID', {
        category: errorCategory,
        message: dbConnectionError.message,
        requestId,
        templateId: cleanedTemplateId,
      });

      // ✅ NOUVEAU: captureDatabaseError adapté pour Server Components
      captureDatabaseError(dbConnectionError, {
        tags: {
          component: 'template_by_id_server_component',
          action: 'db_connection_failed',
          operation: 'connection',
          entity: 'template',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          templateId: cleanedTemplateId,
          timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
        },
      });

      // Retourner null plutôt que de faire planter la page
      return null;
    }

    // ===== ÉTAPE 4: EXÉCUTION DE LA REQUÊTE =====
    let result;
    try {
      const templateQuery = `
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
        WHERE template_id = $1
      `;

      result = await client.query(templateQuery, [cleanedTemplateId]);
    } catch (queryError) {
      const errorCategory = categorizeError(queryError);

      logger.error('Template Fetch By ID Query Error', {
        category: errorCategory,
        message: queryError.message,
        templateId: cleanedTemplateId,
        requestId,
      });

      // ✅ NOUVEAU: captureDatabaseError avec contexte spécifique
      captureDatabaseError(queryError, {
        tags: {
          component: 'template_by_id_server_component',
          action: 'query_failed',
          operation: 'SELECT',
          entity: 'template',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          templateId: cleanedTemplateId,
          table: 'catalog.templates',
          queryType: 'template_fetch_by_id',
          postgresCode: queryError.code,
          postgresDetail: queryError.detail ? '[Filtered]' : undefined,
        },
      });

      if (client) await client.cleanup();
      return null; // Retourner null plutôt que de faire planter la page
    }

    // ===== ÉTAPE 5: VÉRIFICATION EXISTENCE DU TEMPLATE =====
    if (result.rows.length === 0) {
      logger.warn('Template not found', {
        requestId,
        templateId: cleanedTemplateId,
      });

      // ✅ NOUVEAU: captureMessage pour les problèmes de logique métier
      captureMessage('Template not found (Server Component)', {
        level: 'warning',
        tags: {
          component: 'template_by_id_server_component',
          action: 'template_not_found',
          error_category: 'business_logic',
          entity: 'template',
          operation: 'read',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          templateId: cleanedTemplateId,
        },
      });

      if (client) await client.cleanup();
      return null; // Template non trouvé
    }

    // ===== ÉTAPE 6: FORMATAGE DES DONNÉES =====
    const template = result.rows[0];
    const sanitizedTemplate = {
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
    };

    // ===== ÉTAPE 7: MISE EN CACHE DES DONNÉES =====
    // Mettre les données en cache
    const cacheSuccess = dashboardCache.singleTemplate.set(
      cacheKey,
      sanitizedTemplate,
    );

    if (!cacheSuccess) {
      logger.warn('Failed to cache template data', {
        requestId,
        templateId: cleanedTemplateId,
      });
    }

    // ===== ÉTAPE 8: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Template fetch by ID successful', {
      templateId: cleanedTemplateId,
      templateName: sanitizedTemplate.template_name,
      response_time_ms: responseTime,
      requestId,
    });

    // ✅ NOUVEAU: captureMessage de succès
    captureMessage(
      'Template fetch by ID completed successfully (Server Component)',
      {
        level: 'info',
        tags: {
          component: 'template_by_id_server_component',
          action: 'fetch_by_id_success',
          success: 'true',
          entity: 'template',
          operation: 'read',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          templateId: cleanedTemplateId,
          templateName: sanitizedTemplate.template_name,
          responseTimeMs: responseTime,
          databaseOperations: 2,
          cacheMiss: true,
          cacheSet: cacheSuccess,
        },
      },
    );

    if (client) await client.cleanup();

    return sanitizedTemplate;
  } catch (error) {
    // ===== GESTION GLOBALE DES ERREURS =====
    const errorCategory = categorizeError(error);
    const responseTime = Date.now() - startTime;

    logger.error('Global Template By ID Error', {
      category: errorCategory,
      response_time_ms: responseTime,
      error_message: error.message,
      requestId,
      templateId,
    });

    // ✅ NOUVEAU: captureException adapté pour Server Components
    captureException(error, {
      level: 'error',
      tags: {
        component: 'template_by_id_server_component',
        action: 'global_error_handler',
        error_category: errorCategory,
        critical: 'true',
        entity: 'template',
        operation: 'read',
        execution_context: 'server_component',
      },
      extra: {
        requestId,
        templateId,
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'template_fetch_by_id_server_component',
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
      logger.warn('Unauthenticated access attempt to template edit page');

      // ✅ NOUVEAU: captureMessage pour tentative d'accès non authentifiée
      captureMessage('Unauthenticated access attempt to template edit page', {
        level: 'warning',
        tags: {
          component: 'template_by_id_server_component',
          action: 'auth_check_failed',
          error_category: 'authentication',
          execution_context: 'server_component',
        },
        extra: {
          timestamp: new Date().toISOString(),
          page: 'template_edit',
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
        component: 'template_by_id_server_component',
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
 * Server Component principal pour la page d'édition d'un template
 * ✅ NOUVEAU: Wrappé avec monitoring automatique
 */
const EditTemplatePageComponent = async ({ params }) => {
  try {
    // Attendre les paramètres (requis en Next.js 15)
    const { id } = await params;

    // ===== ÉTAPE 1: VÉRIFICATION AUTHENTIFICATION =====
    const session = await checkAuthentication();

    if (!session) {
      // Rediriger vers la page de login si non authentifié
      redirect('/login');
    }

    // ===== ÉTAPE 2: RÉCUPÉRATION DU TEMPLATE =====
    const template = await getTemplateFromDatabase(id);

    // ===== ÉTAPE 3: VÉRIFICATION EXISTENCE =====
    if (!template) {
      // Template non trouvé ou ID invalide, afficher 404
      notFound();
    }

    // ===== ÉTAPE 4: RENDU DE LA PAGE =====
    logger.info('Template edit page rendering', {
      templateId: template.template_id,
      templateName: template.template_name,
      userId: session.user?.id,
    });

    return <EditTemplate template={template} />;
  } catch (error) {
    // Gestion des erreurs au niveau de la page
    logger.error('Template edit page error', {
      error: error.message,
    });

    // ✅ NOUVEAU: captureServerComponentError pour erreurs de rendu
    captureServerComponentError(error, {
      componentName: 'EditTemplatePage',
      route: '/dashboard/templates/[id]',
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
const EditTemplatePage = withServerComponentMonitoring(
  EditTemplatePageComponent,
  'EditTemplatePage',
);

export default EditTemplatePage;
