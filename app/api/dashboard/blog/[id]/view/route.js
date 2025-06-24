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
import { applyRateLimit } from '@backend/rateLimiter';
import { articleIdSchema } from '@utils/schemas/articleSchema';

// Force dynamic pour éviter la mise en cache statique
export const dynamic = 'force-dynamic';

// ----- CONFIGURATION DU RATE LIMITING POUR UN ARTICLE -----

// Créer le middleware de rate limiting spécifique pour un article
const singleArticleRateLimit = applyRateLimit('PUBLIC_API', {
  // Configuration pour article individuel (accessible publiquement)
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requêtes par minute (plus généreux pour lecture publique)
  message:
    'Trop de requêtes vers cet article. Veuillez réessayer dans quelques instants.',
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
  prefix: 'single_article',

  // Fonction personnalisée pour générer la clé (basée sur IP + ID article)
  keyGenerator: (req) => {
    const ip = extractRealIp(req);
    // Extraire l'ID de l'article depuis l'URL
    const url = req.url || req.nextUrl?.pathname || '';
    const articleId = url.split('/').pop()?.split('?')[0] || 'unknown';
    return `single_article:${articleId}:ip:${ip}`;
  },
});

// ----- API ROUTE PRINCIPALE AVEC RATE LIMITING ET MONITORING SENTRY -----

export async function GET(req, { params }) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();

  logger.info('Single Article API called', {
    timestamp: new Date().toISOString(),
    requestId,
    component: 'single_article',
    action: 'api_start',
    method: 'GET',
  });

  // Capturer le début du processus de récupération de l'article
  captureMessage('Single article fetch process started', {
    level: 'info',
    tags: {
      component: 'single_article',
      action: 'process_start',
      api_endpoint: '/api/dashboard/blog/[id]/view',
      entity: 'blog_article',
    },
    extra: {
      requestId,
      timestamp: new Date().toISOString(),
      method: 'GET',
    },
  });

  try {
    // ===== ÉTAPE 1: APPLIQUER LE RATE LIMITING =====
    logger.debug('Applying rate limiting for single article API', {
      requestId,
      component: 'single_article',
      action: 'rate_limit_start',
    });

    const rateLimitResponse = await singleArticleRateLimit(req);

    // Si le rate limiter retourne une réponse, cela signifie que la limite est dépassée
    if (rateLimitResponse) {
      logger.warn('Single Article API rate limit exceeded', {
        requestId,
        component: 'single_article',
        action: 'rate_limit_exceeded',
        ip: anonymizeIp(extractRealIp(req)),
      });

      // Capturer l'événement de rate limiting avec Sentry
      captureMessage('Single Article API rate limit exceeded', {
        level: 'warning',
        tags: {
          component: 'single_article',
          action: 'rate_limit_exceeded',
          error_category: 'rate_limiting',
          entity: 'blog_article',
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
      component: 'single_article',
      action: 'rate_limit_passed',
    });

    // ===== ÉTAPE 2: VALIDATION DE L'ID ARTICLE =====
    logger.debug('Validating article ID', {
      requestId,
      component: 'single_article',
      action: 'validation_start',
    });

    // Récupérer l'ID depuis les paramètres
    const { id } = await params;

    if (!id) {
      logger.warn('Article ID missing from request', {
        requestId,
        component: 'single_article',
        action: 'validation_failed',
        reason: 'missing_id',
      });

      return NextResponse.json(
        {
          success: false,
          message: 'Article ID is required',
          requestId,
        },
        {
          status: 400,
          headers: {
            'X-Request-ID': requestId,
          },
        },
      );
    }

    // Valider l'ID avec le schéma Yup
    try {
      await articleIdSchema.validate({ id });

      logger.debug('Article ID validation successful', {
        requestId,
        component: 'single_article',
        action: 'validation_success',
        articleId: id,
      });
    } catch (validationError) {
      logger.warn('Invalid article ID format', {
        requestId,
        component: 'single_article',
        action: 'validation_failed',
        articleId: id,
        error: validationError.message,
      });

      captureMessage('Invalid article ID format provided', {
        level: 'warning',
        tags: {
          component: 'single_article',
          action: 'validation_failed',
          error_category: 'validation',
          entity: 'blog_article',
        },
        extra: {
          requestId,
          articleId: id,
          validationError: validationError.message,
          ip: anonymizeIp(extractRealIp(req)),
        },
      });

      return NextResponse.json(
        {
          success: false,
          message: validationError.message,
          requestId,
        },
        {
          status: 400,
          headers: {
            'X-Request-ID': requestId,
          },
        },
      );
    }

    // ===== ÉTAPE 4: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
      logger.debug('Database connection successful', {
        requestId,
        component: 'single_article',
        action: 'db_connection_success',
        articleId: id,
      });
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Database Connection Error during single article fetch', {
        category: errorCategory,
        message: dbConnectionError.message,
        articleId: id,
        timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
        requestId,
        component: 'single_article',
        action: 'db_connection_failed',
      });

      // Capturer l'erreur de connexion DB avec Sentry
      captureDatabaseError(dbConnectionError, {
        tags: {
          component: 'single_article',
          action: 'db_connection_failed',
          operation: 'connection',
          entity: 'blog_article',
        },
        extra: {
          requestId,
          articleId: id,
          timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
          ip: anonymizeIp(extractRealIp(req)),
          rateLimitingApplied: true,
        },
      });

      return NextResponse.json(
        {
          success: false,
          error: 'Database connection failed',
          requestId,
        },
        {
          status: 503,
          headers: {
            'X-Request-ID': requestId,
          },
        },
      );
    }

    // ===== ÉTAPE 5: EXÉCUTION DE LA REQUÊTE =====
    let result;
    try {
      const articleQuery = {
        name: 'get-single-article',
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
        values: [id],
      };

      logger.debug('Executing single article query', {
        requestId,
        component: 'single_article',
        action: 'query_start',
        articleId: id,
        table: 'admin.articles',
        operation: 'SELECT',
      });

      result = await client.query(articleQuery);

      logger.debug('Single article query executed successfully', {
        requestId,
        component: 'single_article',
        action: 'query_success',
        articleId: id,
        rowCount: result.rows.length,
        table: 'admin.articles',
      });
    } catch (queryError) {
      const errorCategory = categorizeError(queryError);

      logger.error('Single Article Query Error', {
        category: errorCategory,
        message: queryError.message,
        articleId: id,
        query: 'single_article_fetch',
        table: 'admin.articles',
        requestId,
        component: 'single_article',
        action: 'query_failed',
      });

      // Capturer l'erreur de requête avec Sentry
      captureDatabaseError(queryError, {
        tags: {
          component: 'single_article',
          action: 'query_failed',
          operation: 'SELECT',
          entity: 'blog_article',
        },
        extra: {
          requestId,
          articleId: id,
          table: 'admin.articles',
          queryType: 'single_article_fetch',
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
          error: 'Failed to fetch article from database',
          requestId,
        },
        {
          status: 500,
          headers: {
            'X-Request-ID': requestId,
          },
        },
      );
    }

    // ===== ÉTAPE 6: VALIDATION DES DONNÉES =====
    if (!result || !Array.isArray(result.rows)) {
      logger.warn('Single article query returned invalid data structure', {
        requestId,
        component: 'single_article',
        action: 'invalid_data_structure',
        articleId: id,
        resultType: typeof result,
        hasRows: !!result?.rows,
        isArray: Array.isArray(result?.rows),
      });

      captureMessage('Single article query returned invalid data structure', {
        level: 'warning',
        tags: {
          component: 'single_article',
          action: 'invalid_data_structure',
          error_category: 'business_logic',
          entity: 'blog_article',
        },
        extra: {
          requestId,
          articleId: id,
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
          requestId,
        },
        {
          status: 500,
          headers: {
            'X-Request-ID': requestId,
          },
        },
      );
    }

    // Vérifier si l'article existe
    if (result.rows.length === 0) {
      logger.info('Article not found', {
        requestId,
        component: 'single_article',
        action: 'not_found',
        articleId: id,
      });

      captureMessage('Article not found', {
        level: 'info',
        tags: {
          component: 'single_article',
          action: 'not_found',
          entity: 'blog_article',
        },
        extra: {
          requestId,
          articleId: id,
          ip: anonymizeIp(extractRealIp(req)),
        },
      });

      if (client) await client.cleanup();
      return NextResponse.json(
        {
          success: false,
          message: 'Article not found',
          requestId,
        },
        {
          status: 404,
          headers: {
            'X-Request-ID': requestId,
          },
        },
      );
    }

    // ===== ÉTAPE 7: NETTOYAGE ET FORMATAGE DES DONNÉES =====
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

    logger.debug('Article data sanitized', {
      requestId,
      component: 'single_article',
      action: 'data_sanitization',
      articleId: id,
      hasTitle: !!sanitizedArticle.article_title,
      hasText: !!sanitizedArticle.article_text,
      hasImage: !!sanitizedArticle.article_image,
    });

    // ===== ÉTAPE 9: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Single article fetch successful', {
      articleId: id,
      articleTitle: sanitizedArticle.article_title,
      response_time_ms: responseTime,
      database_operations: 2, // connection + query
      success: true,
      requestId,
      component: 'single_article',
      action: 'fetch_success',
      entity: 'blog_article',
      rateLimitingApplied: true,
    });

    // Capturer le succès de la récupération avec Sentry
    captureMessage('Single article fetch completed successfully', {
      level: 'info',
      tags: {
        component: 'single_article',
        action: 'fetch_success',
        success: 'true',
        entity: 'blog_article',
      },
      extra: {
        requestId,
        articleId: id,
        articleTitle: sanitizedArticle.article_title,
        responseTimeMs: responseTime,
        databaseOperations: 2,
        ip: anonymizeIp(extractRealIp(req)),
        rateLimitingApplied: true,
      },
    });

    if (client) await client.cleanup();

    return NextResponse.json(
      {
        success: true,
        message: 'Article retrieved successfully',
        data: sanitizedArticle,
        meta: {
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
        },
      },
    );
  } catch (error) {
    // ===== GESTION GLOBALE DES ERREURS =====
    const errorCategory = categorizeError(error);
    const responseTime = Date.now() - startTime;

    logger.error('Global Single Article Error', {
      category: errorCategory,
      response_time_ms: responseTime,
      reached_global_handler: true,
      error_name: error.name,
      error_message: error.message,
      stack_available: !!error.stack,
      requestId,
      component: 'single_article',
      action: 'global_error_handler',
      entity: 'blog_article',
    });

    // Capturer l'erreur globale avec Sentry
    captureException(error, {
      level: 'error',
      tags: {
        component: 'single_article',
        action: 'global_error_handler',
        error_category: errorCategory,
        critical: 'true',
        entity: 'blog_article',
      },
      extra: {
        requestId,
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'single_article_fetch',
        ip: anonymizeIp(extractRealIp(req)),
        rateLimitingApplied: true,
      },
    });

    if (client) await client.cleanup();

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: 'Failed to fetch article',
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
