import SingleArticle from '@/ui/pages/blog/SingleArticle';
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
import { articleIdSchema } from '@utils/schemas/articleSchema';
import { dashboardCache, getDashboardCacheKey } from '@/utils/cache';

// Configuration de revalidation pour cette page
export const revalidate = 0; // Désactive le cache statique
export const dynamic = 'force-dynamic'; // Force le rendu dynamique

/**
 * Fonction pour récupérer un article spécifique depuis la base de données
 * ✅ MISE À JOUR: Utilise la nouvelle architecture Sentry
 * Cette fonction remplace l'appel API et s'exécute directement côté serveur
 * @param {string} articleId - L'ID de l'article à récupérer
 * @returns {Promise<Object|null>} Article ou null si non trouvé/erreur
 */
async function getSingleArticleFromDatabase(articleId) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();

  logger.info('Single Article fetch process started', {
    requestId,
    articleId,
  });

  // ✅ NOUVEAU: Utilisation des fonctions Sentry adaptées
  captureMessage('Get single article process started from Server Component', {
    level: 'info',
    tags: {
      component: 'single_article_server_component',
      action: 'process_start',
      entity: 'blog_article',
      execution_context: 'server_component',
      operation: 'read',
    },
    extra: {
      requestId,
      articleId,
      timestamp: new Date().toISOString(),
      method: 'SERVER_COMPONENT',
    },
  });

  try {
    // ===== ÉTAPE 1: VALIDATION DE L'ID AVEC YUP =====
    try {
      // Valider l'ID avec le schema Yup
      await articleIdSchema.validate({ id: articleId }, { abortEarly: false });
    } catch (validationError) {
      const errorCategory = categorizeError(validationError);

      logger.warn('Article ID validation failed with Yup', {
        category: errorCategory,
        providedId: articleId,
        failed_fields: validationError.inner?.map((err) => err.path) || [],
        requestId,
      });

      // ✅ NOUVEAU: captureMessage pour erreurs de validation
      captureMessage(
        'Article ID validation failed with Yup schema (Server Component)',
        {
          level: 'warning',
          tags: {
            component: 'single_article_server_component',
            action: 'yup_id_validation_failed',
            error_category: 'validation',
            entity: 'blog_article',
            operation: 'read',
            execution_context: 'server_component',
          },
          extra: {
            requestId,
            providedId: articleId,
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

    // ===== ÉTAPE 2: VÉRIFICATION DU CACHE =====
    const cacheKey = getDashboardCacheKey('single_article', {
      endpoint: 'server_component_article_view',
      articleId: articleId,
      version: '1.0',
    });

    // Vérifier si les données sont en cache
    const cachedArticle = dashboardCache.singleBlogArticle.get(cacheKey);

    if (cachedArticle) {
      const responseTime = Date.now() - startTime;

      logger.info('Single article served from cache', {
        articleId,
        articleTitle: cachedArticle.article_title,
        response_time_ms: responseTime,
        requestId,
      });

      // ✅ NOUVEAU: captureMessage adapté pour Server Components
      captureMessage(
        'Single article served from cache successfully (Server Component)',
        {
          level: 'info',
          tags: {
            component: 'single_article_server_component',
            action: 'cache_hit',
            success: 'true',
            entity: 'blog_article',
            execution_context: 'server_component',
            operation: 'read',
          },
          extra: {
            requestId,
            articleId,
            articleTitle: cachedArticle.article_title,
            responseTimeMs: responseTime,
            cacheKey,
          },
        },
      );

      return cachedArticle;
    }

    // ===== ÉTAPE 3: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Database Connection Error during single article fetch', {
        category: errorCategory,
        message: dbConnectionError.message,
        requestId,
        articleId,
      });

      // ✅ NOUVEAU: captureDatabaseError adapté pour Server Components
      captureDatabaseError(dbConnectionError, {
        tags: {
          component: 'single_article_server_component',
          action: 'db_connection_failed',
          operation: 'connection',
          entity: 'blog_article',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          articleId,
          timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
        },
      });

      // Retourner null plutôt que de faire planter la page
      return null;
    }

    // ===== ÉTAPE 4: EXÉCUTION DE LA REQUÊTE =====
    let result;
    try {
      const articleQuery = {
        name: 'get-single-article-server',
        text: `
          SELECT 
            article_id, 
            article_title, 
            article_text, 
            article_image,
            is_active,
            TO_CHAR(article_created, 'DD/MM/YYYY') as created,
            TO_CHAR(article_updated, 'DD/MM/YYYY') as updated
          FROM admin.articles 
          WHERE article_id = $1
        `,
        values: [articleId],
      };

      result = await client.query(articleQuery);
    } catch (queryError) {
      const errorCategory = categorizeError(queryError);

      logger.error('Single Article Query Error', {
        category: errorCategory,
        message: queryError.message,
        articleId,
        requestId,
      });

      // ✅ NOUVEAU: captureDatabaseError avec contexte spécifique
      captureDatabaseError(queryError, {
        tags: {
          component: 'single_article_server_component',
          action: 'query_failed',
          operation: 'SELECT',
          entity: 'blog_article',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          articleId,
          table: 'admin.articles',
          queryType: 'single_article_fetch',
          postgresCode: queryError.code,
          postgresDetail: queryError.detail ? '[Filtered]' : undefined,
        },
      });

      if (client) await client.cleanup();
      return null; // Retourner null plutôt que de faire planter la page
    }

    // ===== ÉTAPE 5: VALIDATION DES DONNÉES =====
    if (!result || !Array.isArray(result.rows)) {
      logger.warn('Single article query returned invalid data structure', {
        requestId,
        articleId,
        resultType: typeof result,
      });

      // ✅ NOUVEAU: captureMessage pour les problèmes de structure de données
      captureMessage(
        'Single article query returned invalid data structure (Server Component)',
        {
          level: 'warning',
          tags: {
            component: 'single_article_server_component',
            action: 'invalid_data_structure',
            error_category: 'business_logic',
            entity: 'blog_article',
            execution_context: 'server_component',
          },
          extra: {
            requestId,
            articleId,
            resultType: typeof result,
            hasRows: !!result?.rows,
            isArray: Array.isArray(result?.rows),
          },
        },
      );

      if (client) await client.cleanup();
      return null; // Retourner null plutôt que de faire planter la page
    }

    // ===== ÉTAPE 6: VÉRIFICATION EXISTENCE DE L'ARTICLE =====
    if (result.rows.length === 0) {
      logger.info('Article not found', {
        requestId,
        articleId,
      });

      // ✅ NOUVEAU: captureMessage pour article non trouvé
      captureMessage('Article not found (Server Component)', {
        level: 'info',
        tags: {
          component: 'single_article_server_component',
          action: 'article_not_found',
          entity: 'blog_article',
          operation: 'read',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          articleId,
        },
      });

      if (client) await client.cleanup();
      return null; // Article non trouvé
    }

    // ===== ÉTAPE 7: FORMATAGE DES DONNÉES =====
    const rawArticle = result.rows[0];
    const sanitizedArticle = {
      article_id: rawArticle.article_id,
      article_title: rawArticle.article_title || '[No Title]',
      article_text: rawArticle.article_text || '',
      article_image: rawArticle.article_image,
      is_active: Boolean(rawArticle.is_active),
      created: rawArticle.created,
      updated: rawArticle.updated,
    };

    // ===== ÉTAPE 8: MISE EN CACHE DES DONNÉES =====
    // Mettre les données en cache
    const cacheSuccess = dashboardCache.singleBlogArticle.set(
      cacheKey,
      sanitizedArticle,
    );

    if (!cacheSuccess) {
      logger.warn('Failed to cache single article data', {
        requestId,
        articleId,
      });
    }

    // ===== ÉTAPE 9: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Single article fetch successful', {
      articleId,
      articleTitle: sanitizedArticle.article_title,
      response_time_ms: responseTime,
      requestId,
    });

    // ✅ NOUVEAU: captureMessage de succès
    captureMessage(
      'Single article fetch completed successfully (Server Component)',
      {
        level: 'info',
        tags: {
          component: 'single_article_server_component',
          action: 'fetch_success',
          success: 'true',
          entity: 'blog_article',
          operation: 'read',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          articleId,
          articleTitle: sanitizedArticle.article_title,
          responseTimeMs: responseTime,
          databaseOperations: 2,
          cacheMiss: true,
          cacheSet: cacheSuccess,
        },
      },
    );

    if (client) await client.cleanup();

    return sanitizedArticle;
  } catch (error) {
    // ===== GESTION GLOBALE DES ERREURS =====
    const errorCategory = categorizeError(error);
    const responseTime = Date.now() - startTime;

    logger.error('Global Single Article Error', {
      category: errorCategory,
      response_time_ms: responseTime,
      error_message: error.message,
      requestId,
      articleId,
    });

    // ✅ NOUVEAU: captureException adapté pour Server Components
    captureException(error, {
      level: 'error',
      tags: {
        component: 'single_article_server_component',
        action: 'global_error_handler',
        error_category: errorCategory,
        critical: 'true',
        entity: 'blog_article',
        operation: 'read',
        execution_context: 'server_component',
      },
      extra: {
        requestId,
        articleId,
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'single_article_fetch_server_component',
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
      logger.warn('Unauthenticated access attempt to article view page');

      // ✅ NOUVEAU: captureMessage pour tentative d'accès non authentifiée
      captureMessage('Unauthenticated access attempt to article view page', {
        level: 'warning',
        tags: {
          component: 'single_article_server_component',
          action: 'auth_check_failed',
          error_category: 'authentication',
          execution_context: 'server_component',
        },
        extra: {
          timestamp: new Date().toISOString(),
          page: 'article_view',
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
        component: 'single_article_server_component',
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
 * Server Component principal pour la page de visualisation d'un article
 * ✅ NOUVEAU: Wrappé avec monitoring automatique
 * Cette fonction s'exécute côté serveur et remplace l'appel API
 */
const ViewArticlePageComponent = async ({ params }) => {
  try {
    // Attendre les paramètres (requis en Next.js 15)
    const { id } = await params;

    // ===== ÉTAPE 1: VÉRIFICATION AUTHENTIFICATION =====
    const session = await checkAuthentication();

    if (!session) {
      // Rediriger vers la page de login si non authentifié
      redirect('/login');
    }

    // ===== ÉTAPE 2: RÉCUPÉRATION DE L'ARTICLE =====
    const article = await getSingleArticleFromDatabase(id);

    // ===== ÉTAPE 3: VÉRIFICATION EXISTENCE =====
    if (!article) {
      // Article non trouvé ou ID invalide, afficher 404
      notFound();
    }

    // ===== ÉTAPE 4: RENDU DE LA PAGE =====
    logger.info('Article view page rendering', {
      articleId: article.article_id,
      articleTitle: article.article_title,
      userId: session.user?.id,
    });

    return <SingleArticle article={article} />;
  } catch (error) {
    // Gestion des erreurs au niveau de la page
    logger.error('Article view page error', {
      error: error.message,
    });

    // ✅ NOUVEAU: captureServerComponentError pour erreurs de rendu
    captureServerComponentError(error, {
      componentName: 'ViewArticlePage',
      route: '/dashboard/blog/[id]/view',
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
const ViewArticlePage = withServerComponentMonitoring(
  ViewArticlePageComponent,
  'ViewArticlePage',
);

export default ViewArticlePage;
