import { NextResponse } from 'next/server';
import { getClient } from '@backend/dbConnect';
import {
  captureException,
  captureMessage,
  captureDatabaseError,
} from '@/monitoring/sentry';
import {
  categorizeError,
  generateRequestId,
  extractRealIp,
  anonymizeIp,
} from '@/utils/helpers';
import logger from '@/utils/logger';
import isAuthenticatedUser from '@backend/authMiddleware';
import { applyRateLimit } from '@backend/rateLimiter';
import {
  dashboardCache,
  getDashboardCacheKey,
  getCacheHeaders,
  cacheEvents,
} from '@/utils/cache';

// ----- CONFIGURATION DU RATE LIMITING POUR LES ARTICLES -----

// Créer le middleware de rate limiting spécifique pour les articles
const articlesRateLimit = applyRateLimit('AUTHENTICATED_API', {
  // Configuration personnalisée pour les articles
  windowMs: 2 * 60 * 1000, // 2 minutes
  max: 60, // 60 requêtes par 2 minutes (plus généreux pour les APIs de lecture)
  message:
    'Trop de requêtes vers les articles. Veuillez réessayer dans quelques instants.',
  skipSuccessfulRequests: false, // Compter toutes les requêtes réussies
  skipFailedRequests: false, // Compter aussi les échecs
  prefix: 'articles', // Préfixe spécifique pour les articles

  // Fonction personnalisée pour générer la clé (basée sur IP)
  keyGenerator: (req) => {
    const ip = extractRealIp(req);
    return `articles:ip:${ip}`;
  },
});

// ----- API ROUTE PRINCIPALE AVEC RATE LIMITING ET MONITORING SENTRY -----

export async function GET(req) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();

  logger.info('Articles API called', {
    timestamp: new Date().toISOString(),
    requestId,
    component: 'blog',
    action: 'api_start',
    method: 'GET',
    operation: 'fetch_articles',
  });

  // Capturer le début du processus de récupération des articles
  captureMessage('Articles fetch process started', {
    level: 'info',
    tags: {
      component: 'blog',
      action: 'process_start',
      api_endpoint: '/api/dashboard/blog',
      entity: 'article',
      operation: 'fetch',
    },
    extra: {
      requestId,
      timestamp: new Date().toISOString(),
      method: 'GET',
    },
  });

  try {
    // ===== ÉTAPE 1: APPLIQUER LE RATE LIMITING =====
    logger.debug('Applying rate limiting for articles API', {
      requestId,
      component: 'blog',
      action: 'rate_limit_start',
      operation: 'fetch_articles',
    });

    const rateLimitResponse = await articlesRateLimit(req);

    // Si le rate limiter retourne une réponse, cela signifie que la limite est dépassée
    if (rateLimitResponse) {
      logger.warn('Articles API rate limit exceeded', {
        requestId,
        component: 'blog',
        action: 'rate_limit_exceeded',
        operation: 'fetch_articles',
        ip: anonymizeIp(extractRealIp(req)),
      });

      // Capturer l'événement de rate limiting avec Sentry
      captureMessage('Articles API rate limit exceeded', {
        level: 'warning',
        tags: {
          component: 'blog',
          action: 'rate_limit_exceeded',
          error_category: 'rate_limiting',
          entity: 'article',
          operation: 'fetch',
        },
        extra: {
          requestId,
          ip: anonymizeIp(extractRealIp(req)),
          userAgent:
            req.headers.get('user-agent')?.substring(0, 100) || 'unknown',
        },
      });

      return rateLimitResponse; // Retourner directement la réponse 429
    }

    logger.debug('Rate limiting passed successfully', {
      requestId,
      component: 'blog',
      action: 'rate_limit_passed',
      operation: 'fetch_articles',
    });

    // ===== ÉTAPE 2: VÉRIFICATION AUTHENTIFICATION =====
    logger.debug('Verifying user authentication', {
      requestId,
      component: 'blog',
      action: 'auth_verification_start',
      operation: 'fetch_articles',
    });

    await isAuthenticatedUser(req, NextResponse);

    logger.debug('User authentication verified successfully', {
      requestId,
      component: 'blog',
      action: 'auth_verification_success',
      operation: 'fetch_articles',
    });

    // ===== ÉTAPE 3: VÉRIFICATION DU CACHE =====
    const cacheKey = getDashboardCacheKey('articles_list', {
      endpoint: 'dashboard_blog',
      version: '1.0',
    });

    logger.debug('Checking cache for articles', {
      requestId,
      component: 'blog',
      action: 'cache_check_start',
      cacheKey,
    });

    // Vérifier si les données sont en cache
    const cachedArticles = dashboardCache.blogArticles.get(cacheKey);

    if (cachedArticles) {
      const responseTime = Date.now() - startTime;

      logger.info('Articles served from cache', {
        articleCount: cachedArticles.length,
        response_time_ms: responseTime,
        cache_hit: true,
        requestId,
        component: 'blog',
        action: 'cache_hit',
        entity: 'article',
        rateLimitingApplied: true,
      });

      // Capturer le succès du cache avec Sentry
      captureMessage('Articles served from cache successfully', {
        level: 'info',
        tags: {
          component: 'blog',
          action: 'cache_hit',
          success: 'true',
          entity: 'article',
        },
        extra: {
          requestId,
          articleCount: cachedArticles.length,
          responseTimeMs: responseTime,
          cacheKey,
          ip: anonymizeIp(extractRealIp(req)),
          rateLimitingApplied: true,
        },
      });

      // Émettre un événement de cache hit
      cacheEvents.emit('dashboard_hit', {
        key: cacheKey,
        cache: dashboardCache.blogArticles,
        entityType: 'article',
        requestId,
      });

      // Retourner les données en cache avec headers appropriés
      return NextResponse.json(
        {
          success: true,
          articles: cachedArticles,
          meta: {
            count: cachedArticles.length,
            requestId,
            timestamp: new Date().toISOString(),
            fromCache: true,
          },
        },
        {
          status: 200,
          headers: {
            'X-Request-ID': requestId,
            'X-Response-Time': `${responseTime}ms`,
            'X-Cache-Status': 'HIT',
            ...getCacheHeaders('blogArticles'),
          },
        },
      );
    }

    logger.debug('Cache miss, fetching from database', {
      requestId,
      component: 'blog',
      action: 'cache_miss',
    });

    // ===== ÉTAPE 4: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
      logger.debug('Database connection successful', {
        requestId,
        component: 'blog',
        action: 'db_connection_success',
        operation: 'fetch_articles',
      });
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Database Connection Error during articles fetch', {
        category: errorCategory,
        message: dbConnectionError.message,
        timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
        requestId,
        component: 'blog',
        action: 'db_connection_failed',
        operation: 'fetch_articles',
      });

      // Capturer l'erreur de connexion DB avec Sentry
      captureDatabaseError(dbConnectionError, {
        tags: {
          component: 'blog',
          action: 'db_connection_failed',
          operation: 'connection',
          entity: 'article',
        },
        extra: {
          requestId,
          timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
          ip: anonymizeIp(extractRealIp(req)),
          rateLimitingApplied: true,
        },
      });

      return NextResponse.json(
        {
          success: false,
          error: 'Database connection failed',
        },
        { status: 503 },
      );
    }

    // ===== ÉTAPE 5: EXÉCUTION DE LA REQUÊTE =====
    let result;
    try {
      const articlesQuery = `
        SELECT
          article_id,
          article_title,
          article_image,
          is_active,
          TO_CHAR(article_created_at, 'YYYY-MM-DD') AS created,
          TO_CHAR(article_updated_at, 'YYYY-MM-DD HH24:MI:SS') AS updated
        FROM admin.articles
        ORDER BY article_created DESC, article_id DESC
      `;

      logger.debug('Executing articles query', {
        requestId,
        component: 'blog',
        action: 'query_start',
        table: 'admin.articles',
        operation: 'SELECT',
      });

      result = await client.query(articlesQuery);

      logger.debug('Articles query executed successfully', {
        requestId,
        component: 'blog',
        action: 'query_success',
        rowCount: result.rows.length,
        table: 'admin.articles',
      });
    } catch (queryError) {
      const errorCategory = categorizeError(queryError);

      logger.error('Articles Query Error', {
        category: errorCategory,
        message: queryError.message,
        query: 'articles_fetch',
        table: 'admin.articles',
        requestId,
        component: 'blog',
        action: 'query_failed',
        operation: 'fetch_articles',
      });

      // Capturer l'erreur de requête avec Sentry
      captureDatabaseError(queryError, {
        tags: {
          component: 'blog',
          action: 'query_failed',
          operation: 'SELECT',
          entity: 'article',
        },
        extra: {
          requestId,
          table: 'admin.articles',
          queryType: 'articles_fetch',
          postgresCode: queryError.code,
          postgresDetail: queryError.detail ? '[Filtered]' : undefined,
          ip: anonymizeIp(extractRealIp(req)),
          rateLimitingApplied: true,
        },
      });

      if (client) await client.cleanup();
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to fetch articles from database',
        },
        { status: 500 },
      );
    }

    // ===== ÉTAPE 6: VALIDATION DES DONNÉES =====
    if (!result || !Array.isArray(result.rows)) {
      logger.warn('Articles query returned invalid data structure', {
        requestId,
        component: 'blog',
        action: 'invalid_data_structure',
        resultType: typeof result,
        hasRows: !!result?.rows,
        isArray: Array.isArray(result?.rows),
      });

      captureMessage('Articles query returned invalid data structure', {
        level: 'warning',
        tags: {
          component: 'blog',
          action: 'invalid_data_structure',
          error_category: 'business_logic',
          entity: 'article',
        },
        extra: {
          requestId,
          resultType: typeof result,
          hasRows: !!result?.rows,
          isArray: Array.isArray(result?.rows),
        },
      });

      if (client) await client.cleanup();
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid data structure returned from database',
        },
        { status: 500 },
      );
    }

    // ===== ÉTAPE 7: NETTOYAGE ET FORMATAGE DES DONNÉES =====
    const sanitizedArticles = result.rows.map((article) => ({
      articleId: article.article_id,
      articleTitle: article.article_title || '[No Title]',
      articleImage: article.article_image,
      isActive: Boolean(article.is_active),
      created: article.created,
      updated: article.updated,
    }));

    logger.debug('Articles data sanitized', {
      requestId,
      component: 'blog',
      action: 'data_sanitization',
      originalCount: result.rows.length,
      sanitizedCount: sanitizedArticles.length,
      activeArticles: sanitizedArticles.filter((a) => a.is_active).length,
    });

    // ===== ÉTAPE 8: MISE EN CACHE DES DONNÉES =====
    logger.debug('Caching articles data', {
      requestId,
      component: 'blog',
      action: 'cache_set_start',
      articleCount: sanitizedArticles.length,
    });

    // Mettre les données en cache
    const cacheSuccess = dashboardCache.blogArticles.set(
      cacheKey,
      sanitizedArticles,
    );

    if (cacheSuccess) {
      logger.debug('Articles data cached successfully', {
        requestId,
        component: 'blog',
        action: 'cache_set_success',
        cacheKey,
      });

      // Émettre un événement de cache set
      cacheEvents.emit('dashboard_set', {
        key: cacheKey,
        cache: dashboardCache.blogArticles,
        entityType: 'article',
        requestId,
        size: sanitizedArticles.length,
      });
    } else {
      logger.warn('Failed to cache articles data', {
        requestId,
        component: 'blog',
        action: 'cache_set_failed',
        cacheKey,
      });
    }

    // ===== ÉTAPE 9: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Articles fetch successful', {
      articleCount: sanitizedArticles.length,
      activeArticles: sanitizedArticles.filter((a) => a.is_active).length,
      response_time_ms: responseTime,
      database_operations: 2, // connection + query
      success: true,
      requestId,
      component: 'blog',
      action: 'fetch_success',
      entity: 'article',
      rateLimitingApplied: true,
      cacheMiss: true,
      cacheSet: cacheSuccess,
      operation: 'fetch_articles',
    });

    // Capturer le succès de la récupération avec Sentry
    captureMessage('Articles fetch completed successfully', {
      level: 'info',
      tags: {
        component: 'blog',
        action: 'fetch_success',
        success: 'true',
        entity: 'article',
        operation: 'fetch',
      },
      extra: {
        requestId,
        articleCount: sanitizedArticles.length,
        activeArticles: sanitizedArticles.filter((a) => a.is_active).length,
        responseTimeMs: responseTime,
        databaseOperations: 2,
        ip: anonymizeIp(extractRealIp(req)),
        rateLimitingApplied: true,
        cacheMiss: true,
        cacheSet: cacheSuccess,
      },
    });

    if (client) await client.cleanup();

    return NextResponse.json(
      {
        success: true,
        articles: sanitizedArticles,
        meta: {
          count: sanitizedArticles.length,
          activeCount: sanitizedArticles.filter((a) => a.is_active).length,
          requestId,
          timestamp: new Date().toISOString(),
          fromCache: false,
        },
      },
      {
        status: 200,
        headers: {
          'X-Request-ID': requestId,
          'X-Response-Time': `${responseTime}ms`,
          'X-Cache-Status': 'MISS',
          ...getCacheHeaders('blogArticles'),
        },
      },
    );
  } catch (error) {
    // ===== GESTION GLOBALE DES ERREURS =====
    const errorCategory = categorizeError(error);
    const responseTime = Date.now() - startTime;

    logger.error('Global Articles Error', {
      category: errorCategory,
      response_time_ms: responseTime,
      reached_global_handler: true,
      error_name: error.name,
      error_message: error.message,
      stack_available: !!error.stack,
      requestId,
      component: 'blog',
      action: 'global_error_handler',
      entity: 'article',
      operation: 'fetch_articles',
    });

    // Capturer l'erreur globale avec Sentry
    captureException(error, {
      level: 'error',
      tags: {
        component: 'blog',
        action: 'global_error_handler',
        error_category: errorCategory,
        critical: 'true',
        entity: 'article',
        operation: 'fetch',
      },
      extra: {
        requestId,
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'articles_fetch',
        ip: anonymizeIp(extractRealIp(req)),
        rateLimitingApplied: true,
      },
    });

    if (client) await client.cleanup();

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message:
          'Unable to fetch articles at the moment. Please try again later.',
        requestId,
      },
      {
        status: 500,
        headers: {
          'X-Request-ID': requestId,
          'X-Response-Time': `${responseTime}ms`,
        },
      },
    );
  }
}
