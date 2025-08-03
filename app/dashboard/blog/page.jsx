import ListArticles from '@/ui/pages/blog/ListArticles';
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
 * Fonction pour récupérer les articles depuis la base de données
 * ✅ MISE À JOUR: Utilise la nouvelle architecture Sentry
 * @returns {Promise<Array>} Liste des articles ou tableau vide en cas d'erreur
 */
async function getArticlesFromDatabase() {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();

  logger.info('Articles fetch process started', {
    requestId,
  });

  // ✅ NOUVEAU: Utilisation des fonctions Sentry adaptées
  captureMessage('Articles fetch process started from Server Component', {
    level: 'info',
    tags: {
      component: 'blog_server_component',
      action: 'process_start',
      entity: 'article',
      execution_context: 'server_component',
      operation: 'fetch',
    },
    extra: {
      requestId,
      timestamp: new Date().toISOString(),
      method: 'SERVER_COMPONENT',
    },
  });

  try {
    // ===== ÉTAPE 1: VÉRIFICATION DU CACHE =====
    const cacheKey = getDashboardCacheKey('articles_list', {
      endpoint: 'server_component_blog',
      version: '1.0',
    });

    // Vérifier si les données sont en cache
    const cachedArticles = dashboardCache.blogArticles.get(cacheKey);

    if (cachedArticles) {
      const responseTime = Date.now() - startTime;

      logger.info('Articles served from cache', {
        articleCount: cachedArticles.length,
        response_time_ms: responseTime,
        requestId,
      });

      // ✅ NOUVEAU: captureMessage adapté pour Server Components
      captureMessage(
        'Articles served from cache successfully (Server Component)',
        {
          level: 'info',
          tags: {
            component: 'blog_server_component',
            action: 'cache_hit',
            success: 'true',
            entity: 'article',
            execution_context: 'server_component',
          },
          extra: {
            requestId,
            articleCount: cachedArticles.length,
            responseTimeMs: responseTime,
            cacheKey,
          },
        },
      );

      // Émettre un événement de cache hit
      cacheEvents.emit('dashboard_hit', {
        key: cacheKey,
        cache: dashboardCache.blogArticles,
        entityType: 'article',
        requestId,
        context: 'server_component',
      });

      return cachedArticles;
    }

    // ===== ÉTAPE 2: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Database Connection Error during articles fetch', {
        category: errorCategory,
        message: dbConnectionError.message,
        requestId,
      });

      // ✅ NOUVEAU: captureDatabaseError adapté pour Server Components
      captureDatabaseError(dbConnectionError, {
        tags: {
          component: 'blog_server_component',
          action: 'db_connection_failed',
          operation: 'connection',
          entity: 'article',
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
      const articlesQuery = `
        SELECT
          article_id,
          article_title,
          article_image,
          is_active,
          TO_CHAR(article_created, 'YYYY-MM-DD') AS created,
          TO_CHAR(article_updated, 'YYYY-MM-DD HH24:MI:SS') AS updated
        FROM admin.articles
        ORDER BY article_created DESC, article_id DESC
      `;

      result = await client.query(articlesQuery);
    } catch (queryError) {
      const errorCategory = categorizeError(queryError);

      logger.error('Articles Query Error', {
        category: errorCategory,
        message: queryError.message,
        requestId,
      });

      // ✅ NOUVEAU: captureDatabaseError avec contexte spécifique
      captureDatabaseError(queryError, {
        tags: {
          component: 'blog_server_component',
          action: 'query_failed',
          operation: 'SELECT',
          entity: 'article',
          execution_context: 'server_component',
        },
        extra: {
          requestId,
          table: 'admin.articles',
          queryType: 'articles_fetch',
          postgresCode: queryError.code,
          postgresDetail: queryError.detail ? '[Filtered]' : undefined,
        },
      });

      if (client) await client.cleanup();
      return []; // Retourner un tableau vide plutôt que de faire planter la page
    }

    // ===== ÉTAPE 4: VALIDATION DES DONNÉES =====
    if (!result || !Array.isArray(result.rows)) {
      logger.warn('Articles query returned invalid data structure', {
        requestId,
        resultType: typeof result,
      });

      // ✅ NOUVEAU: captureMessage pour les problèmes de structure de données
      captureMessage(
        'Articles query returned invalid data structure (Server Component)',
        {
          level: 'warning',
          tags: {
            component: 'blog_server_component',
            action: 'invalid_data_structure',
            error_category: 'business_logic',
            entity: 'article',
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
    const sanitizedArticles = result.rows.map((article) => ({
      articleId: article.article_id,
      articleTitle: article.article_title || '[No Title]',
      articleImage: article.article_image,
      isActive: Boolean(article.is_active),
      created: article.created,
      updated: article.updated,
    }));

    // ===== ÉTAPE 6: MISE EN CACHE DES DONNÉES =====
    // Mettre les données en cache
    const cacheSuccess = dashboardCache.blogArticles.set(
      cacheKey,
      sanitizedArticles,
    );

    if (cacheSuccess) {
      // Émettre un événement de cache set
      cacheEvents.emit('dashboard_set', {
        key: cacheKey,
        cache: dashboardCache.blogArticles,
        entityType: 'article',
        requestId,
        size: sanitizedArticles.length,
        context: 'server_component',
      });
    } else {
      logger.warn('Failed to cache articles data', {
        requestId,
        cacheKey,
      });
    }

    // ===== ÉTAPE 7: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Articles fetch successful', {
      articleCount: sanitizedArticles.length,
      activeArticles: sanitizedArticles.filter((a) => a.isActive).length,
      response_time_ms: responseTime,
      requestId,
    });

    // ✅ NOUVEAU: captureMessage de succès
    captureMessage('Articles fetch completed successfully (Server Component)', {
      level: 'info',
      tags: {
        component: 'blog_server_component',
        action: 'fetch_success',
        success: 'true',
        entity: 'article',
        operation: 'fetch',
        execution_context: 'server_component',
      },
      extra: {
        requestId,
        articleCount: sanitizedArticles.length,
        activeArticles: sanitizedArticles.filter((a) => a.isActive).length,
        responseTimeMs: responseTime,
        databaseOperations: 2,
        cacheMiss: true,
        cacheSet: cacheSuccess,
      },
    });

    if (client) await client.cleanup();

    return sanitizedArticles;
  } catch (error) {
    // ===== GESTION GLOBALE DES ERREURS =====
    const errorCategory = categorizeError(error);
    const responseTime = Date.now() - startTime;

    logger.error('Global Articles Error', {
      category: errorCategory,
      response_time_ms: responseTime,
      error_message: error.message,
      requestId,
    });

    // ✅ NOUVEAU: captureException adapté pour Server Components
    captureException(error, {
      level: 'error',
      tags: {
        component: 'blog_server_component',
        action: 'global_error_handler',
        error_category: errorCategory,
        critical: 'true',
        entity: 'article',
        operation: 'fetch',
        execution_context: 'server_component',
      },
      extra: {
        requestId,
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'articles_fetch_server_component',
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
      logger.warn('Unauthenticated access attempt to blog page');

      // ✅ NOUVEAU: captureMessage pour tentative d'accès non authentifiée
      captureMessage('Unauthenticated access attempt to blog page', {
        level: 'warning',
        tags: {
          component: 'blog_server_component',
          action: 'auth_check_failed',
          error_category: 'authentication',
          execution_context: 'server_component',
        },
        extra: {
          timestamp: new Date().toISOString(),
          page: 'blog',
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
        component: 'blog_server_component',
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
 * Server Component principal pour la page des articles
 * ✅ NOUVEAU: Wrappé avec monitoring automatique
 */
const BlogPageComponent = async () => {
  try {
    // ===== ÉTAPE 1: VÉRIFICATION AUTHENTIFICATION =====
    const session = await checkAuthentication();

    if (!session) {
      // Rediriger vers la page de login si non authentifié
      redirect('/login');
    }

    // ===== ÉTAPE 2: RÉCUPÉRATION DES ARTICLES =====
    const articles = await getArticlesFromDatabase();

    // ===== ÉTAPE 3: RENDU DE LA PAGE =====
    logger.info('Blog page rendering', {
      articleCount: articles.length,
      activeArticles: articles.filter((a) => a.isActive).length,
      userId: session.user?.id,
    });

    return <ListArticles data={articles} />;
  } catch (error) {
    // Gestion des erreurs au niveau de la page
    logger.error('Blog page error', {
      error: error.message,
    });

    // ✅ NOUVEAU: captureServerComponentError pour erreurs de rendu
    captureServerComponentError(error, {
      componentName: 'BlogPage',
      route: '/dashboard/blog',
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
    return <ListArticles data={[]} />;
  }
};

// ✅ NOUVEAU: Export du composant avec monitoring automatique
const BlogPage = withServerComponentMonitoring(BlogPageComponent, 'BlogPage');

export default BlogPage;
