// app/api/dashboard/blog/add/route.js
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
import { sanitizeArticleInputsStrict } from '@/utils/sanitizers/sanitizeArticleInputs';
import { addArticleSchema } from '@utils/schemas/articleSchema';
import { dashboardCache, getDashboardCacheKey } from '@/utils/cache';

// Créer le middleware de rate limiting spécifique pour l'ajout d'articles
const addArticleRateLimit = applyRateLimit('CONTENT_API', {
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 8, // 8 ajouts par 5 minutes
  message:
    "Trop de tentatives d'ajout d'articles. Veuillez réessayer dans quelques minutes.",
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
  prefix: 'add_article',

  keyGenerator: (req) => {
    const ip = extractRealIp(req);
    return `add_article:ip:${ip}`;
  },
});

// Fonction d'invalidation du cache
const invalidateArticlesCache = (requestId) => {
  try {
    const cacheKey = getDashboardCacheKey('articles_list', {
      endpoint: 'dashboard_blog',
      version: '1.0',
    });

    const cacheInvalidated = dashboardCache.blogArticles.delete(cacheKey);

    captureMessage('Articles cache invalidated after addition', {
      level: 'info',
      tags: {
        component: 'blog',
        action: 'cache_invalidation',
        entity: 'article',
        operation: 'create',
      },
      extra: {
        requestId,
        cacheKey,
        invalidated: cacheInvalidated,
      },
    });

    return cacheInvalidated;
  } catch (cacheError) {
    logger.warn('Failed to invalidate articles cache', {
      requestId,
      error: cacheError.message,
    });

    captureException(cacheError, {
      level: 'warning',
      tags: {
        component: 'blog',
        action: 'cache_invalidation_failed',
        error_category: 'cache',
        entity: 'article',
        operation: 'create',
      },
      extra: {
        requestId,
      },
    });

    return false;
  }
};

// Fonction pour créer les headers de réponse
const createResponseHeaders = (
  requestId,
  responseTime,
  rateLimitInfo = null,
) => {
  const headers = {
    'Access-Control-Allow-Origin':
      process.env.NEXT_PUBLIC_SITE_URL || 'same-origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-Requested-With',
    'Cache-Control':
      'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless',
    'Cross-Origin-Resource-Policy': 'same-site',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'none'; connect-src 'self'",
    'X-RateLimit-Window': '300',
    'X-RateLimit-Limit': '8',
    'X-Cache-Invalidation': 'articles',
    'X-Database-Operations': '2',
    'X-Request-ID': requestId,
    'X-Response-Time': `${responseTime}ms`,
    'X-API-Version': '1.0',
    'X-Transaction-Type': 'mutation',
    'X-Entity-Type': 'blog-article',
    'X-Operation-Type': 'create',
    'X-Sanitization-Applied': 'true',
    'X-Yup-Validation-Applied': 'true',
    Vary: 'Authorization, Content-Type',
    'X-Permitted-Cross-Domain-Policies': 'none',
  };

  if (rateLimitInfo) {
    headers['X-RateLimit-Remaining'] =
      rateLimitInfo.remaining?.toString() || '0';
    headers['X-RateLimit-Reset'] = rateLimitInfo.resetTime?.toString() || '0';
  }

  return headers;
};

export async function POST(request) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();

  logger.info('Add Article API called', {
    requestId,
  });

  captureMessage('Add article process started', {
    level: 'info',
    tags: {
      component: 'blog',
      action: 'process_start',
      api_endpoint: '/api/dashboard/blog/add',
      entity: 'article',
      operation: 'create',
    },
    extra: {
      requestId,
      timestamp: new Date().toISOString(),
      method: 'POST',
    },
  });

  try {
    // ===== ÉTAPE 1: APPLIQUER LE RATE LIMITING =====
    const rateLimitResponse = await addArticleRateLimit(request);

    if (rateLimitResponse) {
      logger.warn('Add article API rate limit exceeded', {
        requestId,
        ip: anonymizeIp(extractRealIp(request)),
      });

      captureMessage('Add article API rate limit exceeded', {
        level: 'warning',
        tags: {
          component: 'blog',
          action: 'rate_limit_exceeded',
          error_category: 'rate_limiting',
          entity: 'article',
          operation: 'create',
        },
        extra: {
          requestId,
          ip: anonymizeIp(extractRealIp(request)),
          userAgent:
            request.headers.get('user-agent')?.substring(0, 100) || 'unknown',
        },
      });

      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(requestId, responseTime, {
        remaining: 0,
      });

      const rateLimitBody = await rateLimitResponse.json();
      return NextResponse.json(rateLimitBody, {
        status: 429,
        headers: headers,
      });
    }

    // ===== ÉTAPE 2: VÉRIFICATION AUTHENTIFICATION =====
    await isAuthenticatedUser(request, NextResponse);

    // ===== ÉTAPE 3: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Database Connection Error during article addition', {
        category: errorCategory,
        message: dbConnectionError.message,
        requestId,
      });

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
          ip: anonymizeIp(extractRealIp(request)),
          rateLimitingApplied: true,
        },
      });

      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(requestId, responseTime);

      return NextResponse.json(
        { error: 'Database connection failed' },
        { status: 503, headers },
      );
    }

    // ===== ÉTAPE 4: PARSING ET VALIDATION DU BODY =====
    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      const errorCategory = categorizeError(parseError);

      logger.error('JSON Parse Error during article addition', {
        category: errorCategory,
        message: parseError.message,
        requestId,
      });

      captureException(parseError, {
        level: 'error',
        tags: {
          component: 'blog',
          action: 'json_parse_error',
          error_category: categorizeError(parseError),
          operation: 'create',
        },
        extra: {
          requestId,
          contentType: request.headers.get('content-type'),
          userAgent: request.headers.get('user-agent')?.substring(0, 100),
        },
      });

      if (client) await client.cleanup();

      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(requestId, responseTime);

      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400, headers },
      );
    }

    const { title, text, imageUrl } = body;

    // ===== ÉTAPE 5: SANITIZATION DES INPUTS =====
    const sanitizedInputs = sanitizeArticleInputsStrict({
      title,
      text,
      imageUrl,
    });

    const {
      title: sanitizedTitle,
      text: sanitizedText,
      imageUrl: sanitizedImageUrl,
    } = sanitizedInputs;

    // ===== ÉTAPE 6: VALIDATION AVEC YUP =====
    try {
      await addArticleSchema.validate(
        {
          title: sanitizedTitle,
          text: sanitizedText,
          imageUrl: sanitizedImageUrl,
        },
        { abortEarly: false },
      );
    } catch (validationError) {
      const errorCategory = categorizeError(validationError);

      logger.error('Article Validation Error with Yup', {
        category: errorCategory,
        failed_fields: validationError.inner?.map((err) => err.path) || [],
        total_errors: validationError.inner?.length || 0,
        requestId,
      });

      captureMessage('Article validation failed with Yup schema', {
        level: 'warning',
        tags: {
          component: 'blog',
          action: 'yup_validation_failed',
          error_category: 'validation',
          entity: 'article',
          operation: 'create',
        },
        extra: {
          requestId,
          failedFields: validationError.inner?.map((err) => err.path) || [],
          totalErrors: validationError.inner?.length || 0,
          validationErrors:
            validationError.inner?.map((err) => ({
              field: err.path,
              message: err.message,
            })) || [],
        },
      });

      if (client) await client.cleanup();

      const errors = {};
      validationError.inner.forEach((error) => {
        errors[error.path] = error.message;
      });

      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(requestId, responseTime);

      return NextResponse.json(
        {
          success: false,
          message: 'Validation failed',
          errors,
        },
        {
          status: 422,
          headers: headers,
        },
      );
    }

    // ===== ÉTAPE 7: VALIDATION DES CHAMPS REQUIS (SÉCURITÉ SUPPLÉMENTAIRE) =====
    if (!sanitizedTitle || !sanitizedText || !sanitizedImageUrl) {
      logger.warn(
        'Article validation failed - missing required fields after sanitization',
        {
          requestId,
          missingFields: {
            title: !sanitizedTitle,
            text: !sanitizedText,
            imageUrl: !sanitizedImageUrl,
          },
        },
      );

      captureMessage(
        'Article validation failed - missing required fields after sanitization',
        {
          level: 'warning',
          tags: {
            component: 'blog',
            action: 'validation_failed',
            error_category: 'validation',
            entity: 'article',
            operation: 'create',
          },
          extra: {
            requestId,
            missingFields: {
              title: !sanitizedTitle,
              text: !sanitizedText,
              imageUrl: !sanitizedImageUrl,
            },
          },
        },
      );

      if (client) await client.cleanup();

      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(requestId, responseTime);

      return NextResponse.json(
        {
          success: false,
          message: 'Title, text and image are required',
        },
        {
          status: 400,
          headers: headers,
        },
      );
    }

    // ===== ÉTAPE 8: INSERTION EN BASE DE DONNÉES =====
    let result;
    try {
      const queryText = `
        INSERT INTO admin.articles (
          article_title,
          article_text,
          article_image
        ) VALUES ($1, $2, $3)
        RETURNING article_id, article_title
      `;

      const values = [sanitizedTitle, sanitizedText, sanitizedImageUrl];

      result = await client.query(queryText, values);
    } catch (insertError) {
      const errorCategory = categorizeError(insertError);

      logger.error('Article Insertion Error', {
        category: errorCategory,
        message: insertError.message,
        requestId,
      });

      captureDatabaseError(insertError, {
        tags: {
          component: 'blog',
          action: 'insertion_failed',
          operation: 'INSERT',
          entity: 'article',
        },
        extra: {
          requestId,
          table: 'admin.articles',
          queryType: 'article_insertion',
          postgresCode: insertError.code,
          postgresDetail: insertError.detail ? '[Filtered]' : undefined,
          ip: anonymizeIp(extractRealIp(request)),
          rateLimitingApplied: true,
        },
      });

      if (client) await client.cleanup();

      const responseTime = Date.now() - startTime;
      const headers = createResponseHeaders(requestId, responseTime);

      return NextResponse.json(
        {
          success: false,
          error: 'Failed to add article to database',
        },
        {
          status: 500,
          headers: headers,
        },
      );
    }

    // ===== ÉTAPE 9: INVALIDATION DU CACHE APRÈS SUCCÈS =====
    const newArticleId = result.rows[0].article_id;
    const newArticleTitle = result.rows[0].article_title;

    // Invalider le cache des articles après ajout réussi
    invalidateArticlesCache(requestId);

    // ===== ÉTAPE 10: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Article addition successful', {
      newArticleId,
      articleTitle: newArticleTitle,
      response_time_ms: responseTime,
      success: true,
      requestId,
    });

    captureMessage('Article addition completed successfully', {
      level: 'info',
      tags: {
        component: 'blog',
        action: 'addition_success',
        success: 'true',
        entity: 'article',
        operation: 'create',
      },
      extra: {
        requestId,
        newArticleId,
        articleTitle: newArticleTitle,
        responseTimeMs: responseTime,
        databaseOperations: 2,
        cacheInvalidated: true,
        ip: anonymizeIp(extractRealIp(request)),
        rateLimitingApplied: true,
        sanitizationApplied: true,
        yupValidationApplied: true,
      },
    });

    if (client) await client.cleanup();

    const headers = createResponseHeaders(requestId, responseTime);

    return NextResponse.json(
      {
        success: true,
        message: 'Article added successfully',
        data: {
          articleId: newArticleId,
          title: newArticleTitle,
          createdAt: result.rows[0].article_created_at,
        },
        meta: {
          requestId,
          timestamp: new Date().toISOString(),
        },
      },
      {
        status: 201,
        headers: headers,
      },
    );
  } catch (error) {
    // ===== GESTION GLOBALE DES ERREURS =====
    const errorCategory = categorizeError(error);
    const responseTime = Date.now() - startTime;

    logger.error('Global Add Article Error', {
      category: errorCategory,
      response_time_ms: responseTime,
      error_message: error.message,
      requestId,
    });

    captureException(error, {
      level: 'error',
      tags: {
        component: 'blog',
        action: 'global_error_handler',
        error_category: errorCategory,
        critical: 'true',
        entity: 'article',
        operation: 'create',
      },
      extra: {
        requestId,
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'article_addition',
        ip: anonymizeIp(extractRealIp(request)),
        rateLimitingApplied: true,
      },
    });

    if (client) await client.cleanup();

    const headers = createResponseHeaders(requestId, responseTime);

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: 'Failed to add article',
        requestId,
      },
      {
        status: 500,
        headers: headers,
      },
    );
  }
}
