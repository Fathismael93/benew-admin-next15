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
// AJOUT POUR L'INVALIDATION DU CACHE
import { dashboardCache, getDashboardCacheKey } from '@/utils/cache';

// ----- CONFIGURATION DU RATE LIMITING POUR L'AJOUT D'ARTICLES -----

// Créer le middleware de rate limiting spécifique pour l'ajout d'articles
const addArticleRateLimit = applyRateLimit('CONTENT_API', {
  // Configuration personnalisée pour l'ajout d'articles
  windowMs: 5 * 60 * 1000, // 5 minutes (plus strict pour les mutations)
  max: 8, // 8 ajouts par 5 minutes (plus restrictif car création de contenu)
  message:
    "Trop de tentatives d'ajout d'articles. Veuillez réessayer dans quelques minutes.",
  skipSuccessfulRequests: false, // Compter tous les ajouts réussis
  skipFailedRequests: false, // Compter aussi les échecs
  prefix: 'add_article', // Préfixe spécifique pour l'ajout d'articles

  // Fonction personnalisée pour générer la clé (basée sur IP)
  keyGenerator: (req) => {
    const ip = extractRealIp(req);
    return `add_article:ip:${ip}`;
  },
});

// ----- FONCTION D'INVALIDATION DU CACHE -----
const invalidateArticlesCache = (requestId) => {
  try {
    // Invalider le cache des listes d'articles
    const listCacheKey = getDashboardCacheKey('articles_list', {
      endpoint: 'dashboard_blog',
      version: '1.0',
    });

    const listCacheInvalidated =
      dashboardCache.blogArticles.delete(listCacheKey);

    // Invalider aussi le cache des articles individuels si nécessaire
    const singleCacheKey = getDashboardCacheKey('single_article', {
      endpoint: 'dashboard_blog_single',
      version: '1.0',
    });

    const singleCacheInvalidated =
      dashboardCache.singleBlogArticle.delete(singleCacheKey);

    logger.debug('Articles cache invalidation', {
      requestId,
      component: 'blog',
      action: 'cache_invalidation',
      operation: 'add_article',
      listCacheKey,
      singleCacheKey,
      listInvalidated: listCacheInvalidated,
      singleInvalidated: singleCacheInvalidated,
    });

    // Capturer l'invalidation du cache avec Sentry
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
        listCacheKey,
        singleCacheKey,
        listInvalidated: listCacheInvalidated,
        singleInvalidated: singleCacheInvalidated,
      },
    });

    return {
      listInvalidated: listCacheInvalidated,
      singleInvalidated: singleCacheInvalidated,
    };
  } catch (cacheError) {
    logger.warn('Failed to invalidate articles cache', {
      requestId,
      component: 'blog',
      action: 'cache_invalidation_failed',
      operation: 'add_article',
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

    return {
      listInvalidated: false,
      singleInvalidated: false,
    };
  }
};

// ----- API ROUTE PRINCIPALE AVEC RATE LIMITING -----

export async function POST(request) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();

  logger.info('Add Article API called', {
    timestamp: new Date().toISOString(),
    requestId,
    component: 'blog',
    action: 'api_start',
    method: 'POST',
    operation: 'add_article',
  });

  // Capturer le début du processus d'ajout d'article
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
    logger.debug('Applying rate limiting for add article API', {
      requestId,
      component: 'blog',
      action: 'rate_limit_start',
      operation: 'add_article',
    });

    const rateLimitResponse = await addArticleRateLimit(request);

    // Si le rate limiter retourne une réponse, cela signifie que la limite est dépassée
    if (rateLimitResponse) {
      logger.warn('Add article API rate limit exceeded', {
        requestId,
        component: 'blog',
        action: 'rate_limit_exceeded',
        operation: 'add_article',
        ip: anonymizeIp(extractRealIp(request)),
      });

      // Capturer l'événement de rate limiting avec Sentry
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

      return rateLimitResponse; // Retourner directement la réponse 429
    }

    logger.debug('Rate limiting passed successfully', {
      requestId,
      component: 'blog',
      action: 'rate_limit_passed',
      operation: 'add_article',
    });

    // ===== ÉTAPE 2: VÉRIFICATION AUTHENTIFICATION =====
    logger.debug('Verifying user authentication', {
      requestId,
      component: 'blog',
      action: 'auth_verification_start',
      operation: 'add_article',
    });

    await isAuthenticatedUser(request, NextResponse);

    logger.debug('User authentication verified successfully', {
      requestId,
      component: 'blog',
      action: 'auth_verification_success',
      operation: 'add_article',
    });

    // ===== ÉTAPE 3: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
      logger.debug('Database connection successful', {
        requestId,
        component: 'blog',
        action: 'db_connection_success',
        operation: 'add_article',
      });
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Database Connection Error during article addition', {
        category: errorCategory,
        message: dbConnectionError.message,
        timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
        requestId,
        component: 'blog',
        action: 'db_connection_failed',
        operation: 'add_article',
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
          ip: anonymizeIp(extractRealIp(request)),
          rateLimitingApplied: true,
        },
      });

      return NextResponse.json(
        { error: 'Database connection failed' },
        { status: 503 },
      );
    }

    // ===== ÉTAPE 4: PARSING ET VALIDATION DU BODY =====
    let body;
    try {
      body = await request.json();
      logger.debug('Request body parsed successfully', {
        requestId,
        component: 'blog',
        action: 'body_parse_success',
        operation: 'add_article',
      });
    } catch (parseError) {
      const errorCategory = categorizeError(parseError);

      logger.error('JSON Parse Error during article addition', {
        category: errorCategory,
        message: parseError.message,
        requestId,
        component: 'blog',
        action: 'json_parse_error',
        operation: 'add_article',
        headers: {
          'content-type': request.headers.get('content-type'),
          'user-agent': request.headers.get('user-agent')?.substring(0, 100),
        },
      });

      // Capturer l'erreur de parsing avec Sentry
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
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 },
      );
    }

    const { title, text, imageUrl } = body;

    logger.debug('Article data extracted from request', {
      requestId,
      component: 'blog',
      action: 'data_extraction',
      operation: 'add_article',
      hasTitle: !!title,
      hasText: !!text,
      hasImageUrl: !!imageUrl,
      titleLength: title?.length || 0,
      textLength: text?.length || 0,
    });

    // ===== ÉTAPE 5: SANITIZATION DES INPUTS =====
    logger.debug('Sanitizing article inputs', {
      requestId,
      component: 'blog',
      action: 'input_sanitization',
      operation: 'add_article',
    });

    const sanitizedInputs = sanitizeArticleInputsStrict({
      title,
      text,
      imageUrl,
    });

    // Utiliser les données sanitizées pour la suite du processus
    const {
      title: sanitizedTitle,
      text: sanitizedText,
      imageUrl: sanitizedImageUrl,
    } = sanitizedInputs;

    logger.debug('Input sanitization completed', {
      requestId,
      component: 'blog',
      action: 'input_sanitization_completed',
      operation: 'add_article',
      sanitizedTitleLength: sanitizedTitle?.length || 0,
      sanitizedTextLength: sanitizedText?.length || 0,
    });

    // ===== ÉTAPE 6: VALIDATION AVEC YUP =====
    try {
      // Valider les données sanitizées avec le schema Yup
      await addArticleSchema.validate(
        {
          title: sanitizedTitle,
          text: sanitizedText,
          imageUrl: sanitizedImageUrl,
        },
        { abortEarly: false },
      );

      logger.debug('Article validation with Yup passed', {
        requestId,
        component: 'blog',
        action: 'yup_validation_success',
        operation: 'add_article',
      });
    } catch (validationError) {
      const errorCategory = categorizeError(validationError);

      logger.error('Article Validation Error with Yup', {
        category: errorCategory,
        failed_fields: validationError.inner?.map((err) => err.path) || [],
        total_errors: validationError.inner?.length || 0,
        requestId,
        component: 'blog',
        action: 'yup_validation_failed',
        operation: 'add_article',
      });

      // Capturer l'erreur de validation avec Sentry
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

      return NextResponse.json(
        {
          success: false,
          message: 'Validation failed',
          errors,
        },
        { status: 422 },
      );
    }

    // ===== ÉTAPE 7: VALIDATION DES CHAMPS REQUIS (SÉCURITÉ SUPPLÉMENTAIRE) =====
    if (!sanitizedTitle || !sanitizedText || !sanitizedImageUrl) {
      logger.warn(
        'Article validation failed - missing required fields after sanitization',
        {
          requestId,
          component: 'blog',
          action: 'validation_failed',
          operation: 'add_article',
          missingFields: {
            title: !sanitizedTitle,
            text: !sanitizedText,
            imageUrl: !sanitizedImageUrl,
          },
        },
      );

      // Capturer l'erreur de validation avec Sentry
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
      return NextResponse.json(
        {
          success: false,
          message: 'Title, text and image are required',
        },
        { status: 400 },
      );
    }

    logger.debug('Article validation passed', {
      requestId,
      component: 'blog',
      action: 'validation_success',
      operation: 'add_article',
    });

    // ===== ÉTAPE 8: INSERTION EN BASE DE DONNÉES =====
    let result;
    try {
      const queryText = `
        INSERT INTO admin.articles (
          article_title,
          article_text,
          article_image,
          article_is_active,
          article_created_at
        ) VALUES ($1, $2, $3, $4, NOW())
        RETURNING article_id, article_title, article_created_at
      `;

      const values = [
        sanitizedTitle,
        sanitizedText,
        sanitizedImageUrl,
        true, // Par défaut, les nouveaux articles sont actifs
      ];

      logger.debug('Executing article insertion query', {
        requestId,
        component: 'blog',
        action: 'query_start',
        operation: 'add_article',
        table: 'admin.articles',
      });

      result = await client.query(queryText, values);

      logger.debug('Article insertion query executed successfully', {
        requestId,
        component: 'blog',
        action: 'query_success',
        operation: 'add_article',
        newArticleId: result.rows[0]?.article_id,
        newArticleTitle: result.rows[0]?.article_title,
      });
    } catch (insertError) {
      const errorCategory = categorizeError(insertError);

      logger.error('Article Insertion Error', {
        category: errorCategory,
        message: insertError.message,
        operation: 'INSERT INTO articles',
        table: 'admin.articles',
        requestId,
        component: 'blog',
        action: 'query_failed',
        postgresCode: insertError.code,
        postgresDetail: insertError.detail ? '[Filtered]' : undefined,
      });

      // Capturer l'erreur d'insertion avec Sentry
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
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to add article to database',
        },
        { status: 500 },
      );
    }

    // ===== ÉTAPE 9: INVALIDATION DU CACHE APRÈS SUCCÈS =====
    const newArticleId = result.rows[0].article_id;
    const newArticleTitle = result.rows[0].article_title;

    // Invalider le cache des articles après ajout réussi
    const cacheInvalidationResult = invalidateArticlesCache(requestId);

    // ===== ÉTAPE 10: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Article addition successful', {
      newArticleId,
      articleTitle: newArticleTitle,
      response_time_ms: responseTime,
      database_operations: 2, // connection + insert
      cache_invalidated:
        cacheInvalidationResult.listInvalidated ||
        cacheInvalidationResult.singleInvalidated,
      success: true,
      requestId,
      component: 'blog',
      action: 'addition_success',
      entity: 'article',
      rateLimitingApplied: true,
      operation: 'add_article',
      sanitizationApplied: true,
      yupValidationApplied: true,
    });

    // Capturer le succès de l'ajout avec Sentry
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
        cacheInvalidated:
          cacheInvalidationResult.listInvalidated ||
          cacheInvalidationResult.singleInvalidated,
        ip: anonymizeIp(extractRealIp(request)),
        rateLimitingApplied: true,
        sanitizationApplied: true,
        yupValidationApplied: true,
      },
    });

    if (client) await client.cleanup();

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

    logger.error('Global Add Article Error', {
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
      operation: 'add_article',
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

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: 'Failed to add article',
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
