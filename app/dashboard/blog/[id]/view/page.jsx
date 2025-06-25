import SingleArticle from '@/ui/pages/blog/SingleArticle';
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
import { articleIdSchema } from '@utils/schemas/articleSchema';
import { dashboardCache, getDashboardCacheKey } from '@/utils/cache';

// Configuration de revalidation pour cette page
export const revalidate = 0; // Désactive le cache statique
export const dynamic = 'force-dynamic'; // Force le rendu dynamique

/**
 * Fonction pour récupérer un article spécifique depuis la base de données
 * Cette fonction remplace l'appel API et s'exécute directement côté serveur
 * @param {string} articleId - L'ID de l'article à récupérer
 * @returns {Promise<Object|null>} Article ou null si non trouvé/erreur
 */
async function getSingleArticleFromDatabase(articleId) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();

  logger.info('Single Article fetch process started (Server Component)', {
    timestamp: new Date().toISOString(),
    requestId,
    component: 'single_article_server_component',
    action: 'fetch_start',
    method: 'SERVER_COMPONENT',
    operation: 'get_single_article',
    articleId,
  });

  // Capturer le début du processus de récupération de l'article
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
    logger.debug('Validating article ID with Yup schema (Server Component)', {
      requestId,
      component: 'single_article_server_component',
      action: 'id_validation_start',
      operation: 'get_single_article',
      providedId: articleId,
    });

    try {
      // Valider l'ID avec le schema Yup
      await articleIdSchema.validate({ id: articleId }, { abortEarly: false });

      logger.debug('Article ID validation with Yup passed (Server Component)', {
        requestId,
        component: 'single_article_server_component',
        action: 'yup_id_validation_success',
        operation: 'get_single_article',
        articleId,
      });
    } catch (validationError) {
      const errorCategory = categorizeError(validationError);

      logger.warn('Article ID validation failed with Yup (Server Component)', {
        category: errorCategory,
        providedId: articleId,
        failed_fields: validationError.inner?.map((err) => err.path) || [],
        total_errors: validationError.inner?.length || 0,
        requestId,
        component: 'single_article_server_component',
        action: 'yup_id_validation_failed',
        operation: 'get_single_article',
      });

      // Capturer l'erreur de validation avec Sentry
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

    logger.debug('Article ID validation passed (Server Component)', {
      requestId,
      component: 'single_article_server_component',
      action: 'id_validation_success',
      operation: 'get_single_article',
      articleId,
    });

    // ===== ÉTAPE 2: VÉRIFICATION DU CACHE =====
    const cacheKey = getDashboardCacheKey('single_article', {
      endpoint: 'server_component_article_view',
      articleId: articleId,
      version: '1.0',
    });

    logger.debug('Checking cache for single article (Server Component)', {
      requestId,
      component: 'single_article_server_component',
      action: 'cache_check_start',
      cacheKey,
      articleId,
    });

    // Vérifier si les données sont en cache
    const cachedArticle = dashboardCache.singleBlogArticle.get(cacheKey);

    if (cachedArticle) {
      const responseTime = Date.now() - startTime;

      logger.info('Single article served from cache (Server Component)', {
        articleId,
        articleTitle: cachedArticle.article_title,
        response_time_ms: responseTime,
        cache_hit: true,
        requestId,
        component: 'single_article_server_component',
        action: 'cache_hit',
        entity: 'blog_article',
      });

      // Capturer le succès du cache avec Sentry
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

    logger.debug('Cache miss, fetching from database (Server Component)', {
      requestId,
      component: 'single_article_server_component',
      action: 'cache_miss',
      articleId,
    });

    // ===== ÉTAPE 3: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
      logger.debug('Database connection successful (Server Component)', {
        requestId,
        component: 'single_article_server_component',
        action: 'db_connection_success',
        operation: 'get_single_article',
        articleId,
      });
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error(
        'Database Connection Error during single article fetch (Server Component)',
        {
          category: errorCategory,
          message: dbConnectionError.message,
          timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
          requestId,
          component: 'single_article_server_component',
          action: 'db_connection_failed',
          operation: 'get_single_article',
          articleId,
        },
      );

      // Capturer l'erreur de connexion DB avec Sentry
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

      logger.debug('Executing single article query (Server Component)', {
        requestId,
        component: 'single_article_server_component',
        action: 'query_start',
        operation: 'get_single_article',
        articleId,
        table: 'admin.articles',
      });

      result = await client.query(articleQuery);

      logger.debug(
        'Single article query executed successfully (Server Component)',
        {
          requestId,
          component: 'single_article_server_component',
          action: 'query_success',
          operation: 'get_single_article',
          articleId,
          rowCount: result.rows.length,
        },
      );
    } catch (queryError) {
      const errorCategory = categorizeError(queryError);

      logger.error('Single Article Query Error (Server Component)', {
        category: errorCategory,
        message: queryError.message,
        query: 'single_article_fetch',
        table: 'admin.articles',
        articleId,
        requestId,
        component: 'single_article_server_component',
        action: 'query_failed',
        operation: 'get_single_article',
      });

      // Capturer l'erreur de requête avec Sentry
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
      logger.warn(
        'Single article query returned invalid data structure (Server Component)',
        {
          requestId,
          component: 'single_article_server_component',
          action: 'invalid_data_structure',
          articleId,
          resultType: typeof result,
          hasRows: !!result?.rows,
          isArray: Array.isArray(result?.rows),
        },
      );

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
      logger.info('Article not found (Server Component)', {
        requestId,
        component: 'single_article_server_component',
        action: 'article_not_found',
        operation: 'get_single_article',
        articleId,
      });

      // Capturer l'article non trouvé avec Sentry
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

    logger.debug('Article data sanitized (Server Component)', {
      requestId,
      component: 'single_article_server_component',
      action: 'data_sanitization',
      operation: 'get_single_article',
      articleId,
      hasTitle: !!sanitizedArticle.article_title,
      hasText: !!sanitizedArticle.article_text,
      hasImage: !!sanitizedArticle.article_image,
    });

    // ===== ÉTAPE 8: MISE EN CACHE DES DONNÉES =====
    logger.debug('Caching single article data (Server Component)', {
      requestId,
      component: 'single_article_server_component',
      action: 'cache_set_start',
      articleId,
    });

    // Mettre les données en cache
    const cacheSuccess = dashboardCache.singleBlogArticle.set(
      cacheKey,
      sanitizedArticle,
    );

    if (cacheSuccess) {
      logger.debug(
        'Single article data cached successfully (Server Component)',
        {
          requestId,
          component: 'single_article_server_component',
          action: 'cache_set_success',
          cacheKey,
          articleId,
        },
      );
    } else {
      logger.warn('Failed to cache single article data (Server Component)', {
        requestId,
        component: 'single_article_server_component',
        action: 'cache_set_failed',
        cacheKey,
        articleId,
      });
    }

    // ===== ÉTAPE 9: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Single article fetch successful (Server Component)', {
      articleId,
      articleTitle: sanitizedArticle.article_title,
      response_time_ms: responseTime,
      database_operations: 2, // connection + query
      success: true,
      requestId,
      component: 'single_article_server_component',
      action: 'fetch_success',
      entity: 'blog_article',
      cacheMiss: true,
      cacheSet: cacheSuccess,
      execution_context: 'server_component',
      operation: 'get_single_article',
      yupValidationApplied: true,
    });

    // Capturer le succès de la récupération avec Sentry
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

    logger.error('Global Single Article Error (Server Component)', {
      category: errorCategory,
      response_time_ms: responseTime,
      reached_global_handler: true,
      error_name: error.name,
      error_message: error.message,
      stack_available: !!error.stack,
      requestId,
      articleId,
      component: 'single_article_server_component',
      action: 'global_error_handler',
      entity: 'blog_article',
      operation: 'get_single_article',
      execution_context: 'server_component',
    });

    // Capturer l'erreur globale avec Sentry
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
 * @returns {Promise<Object|null>} Session utilisateur ou null si non authentifié
 */
async function checkAuthentication() {
  try {
    const session = await getServerSession(auth);

    if (!session) {
      logger.warn('Unauthenticated access attempt to article view page', {
        component: 'single_article_server_component',
        action: 'auth_check_failed',
        timestamp: new Date().toISOString(),
      });

      // Capturer la tentative d'accès non authentifiée
      captureMessage('Unauthenticated access attempt to article view page', {
        level: 'warning',
        tags: {
          component: 'single_article_server_component',
          action: 'auth_check_failed',
          error_category: 'authentication',
        },
        extra: {
          timestamp: new Date().toISOString(),
          page: 'article_view',
        },
      });

      return null;
    }

    logger.debug(
      'User authentication verified successfully (Server Component)',
      {
        userId: session.user?.id,
        email: session.user?.email?.substring(0, 3) + '***',
        component: 'single_article_server_component',
        action: 'auth_verification_success',
      },
    );

    return session;
  } catch (error) {
    logger.error('Authentication check error (Server Component)', {
      error: error.message,
      component: 'single_article_server_component',
      action: 'auth_check_error',
    });

    captureException(error, {
      level: 'error',
      tags: {
        component: 'single_article_server_component',
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
 * Server Component principal pour la page de visualisation d'un article
 * Cette fonction s'exécute côté serveur et remplace l'appel API
 */
async function ViewArticlePage({ params }) {
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
    logger.info('Article view page rendering (Server Component)', {
      articleId: article.article_id,
      articleTitle: article.article_title,
      userId: session.user?.id,
      component: 'single_article_server_component',
      action: 'page_render',
      timestamp: new Date().toISOString(),
    });

    return <SingleArticle article={article} />;
  } catch (error) {
    // Gestion des erreurs au niveau de la page
    logger.error('Article view page error (Server Component)', {
      error: error.message,
      stack: error.stack,
      component: 'single_article_server_component',
      action: 'page_error',
    });

    captureException(error, {
      level: 'error',
      tags: {
        component: 'single_article_server_component',
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
}

export default ViewArticlePage;
