/* eslint-disable no-unused-vars */
import { NextResponse } from 'next/server';
import cloudinary from '@backend/cloudinary';
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
import { sanitizeUpdateArticleInputs } from '@/utils/sanitizers/sanitizeArticleInputs';
import {
  updateArticleSchema,
  articleIdSchema,
} from '@/utils/schemas/articleSchema';
import { dashboardCache, getDashboardCacheKey } from '@/utils/cache';

export const dynamic = 'force-dynamic';

// Créer le middleware de rate limiting spécifique pour la modification d'articles
const editArticleRateLimit = applyRateLimit('CONTENT_API', {
  windowMs: 2 * 60 * 1000, // 2 minutes
  max: 15, // 15 modifications par 2 minutes
  message:
    "Trop de tentatives de modification d'articles. Veuillez réessayer dans quelques minutes.",
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
  prefix: 'edit_article',

  keyGenerator: (req) => {
    const ip = extractRealIp(req);
    const url = req.url || req.nextUrl?.pathname || '';
    const articleIdMatch = url.match(/blog\/([^/]+)\/edit/);
    const articleId = articleIdMatch ? articleIdMatch[1] : 'unknown';
    return `edit_article:ip:${ip}:article:${articleId}`;
  },
});

// Fonction d'invalidation du cache
const invalidateArticlesCache = (requestId, articleId) => {
  try {
    const listCacheKey = getDashboardCacheKey('articles_list', {
      endpoint: 'dashboard_articles',
      version: '1.0',
    });

    const listCacheInvalidated =
      dashboardCache.blogArticles.delete(listCacheKey);

    captureMessage('Articles cache invalidated after modification', {
      level: 'info',
      tags: {
        component: 'articles',
        action: 'cache_invalidation',
        entity: 'blog_article',
        operation: 'update',
      },
      extra: {
        requestId,
        articleId,
        listCacheKey,
        listInvalidated: listCacheInvalidated,
      },
    });

    return {
      listInvalidated: listCacheInvalidated,
    };
  } catch (cacheError) {
    logger.warn('Failed to invalidate articles cache', {
      requestId,
      articleId,
      error: cacheError.message,
    });

    captureException(cacheError, {
      level: 'warning',
      tags: {
        component: 'articles',
        action: 'cache_invalidation_failed',
        error_category: 'cache',
        entity: 'blog_article',
        operation: 'update',
      },
      extra: {
        requestId,
        articleId,
      },
    });

    return { listInvalidated: false };
  }
};

// Fonction pour générer les headers de sécurité
const getSecurityHeaders = (requestId, responseTime, articleId) => {
  return {
    'Access-Control-Allow-Origin':
      process.env.NEXT_PUBLIC_SITE_URL || 'same-origin',
    'Access-Control-Allow-Methods': 'PUT, OPTIONS',
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
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Resource-Policy': 'same-site',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'",
    'X-API-Version': '1.0',
    'X-Transaction-Type': 'mutation',
    'X-Entity-Type': 'blog-article',
    'X-Operation-Type': 'update',
    'X-Cache-Invalidation': 'articles',
    'X-Sanitization-Applied': 'true',
    'X-Yup-Validation-Applied': 'true',
    'X-Rate-Limiting-Applied': 'true',
    'X-RateLimit-Window': '120',
    'X-RateLimit-Limit': '15',
    'X-Permitted-Cross-Domain-Policies': 'none',
    'X-Robots-Tag': 'noindex, nofollow',
    Vary: 'Authorization, Content-Type',
    'X-Request-ID': requestId,
    'X-Response-Time': `${responseTime}ms`,
    'X-Content-Category': 'blog-content',
    'X-Database-Operations': '3',
    'X-Resource-ID': articleId,
  };
};

export async function PUT(request, { params }) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();
  const { id } = params;

  logger.info('Edit Article API called', {
    requestId,
    articleId: id,
  });

  captureMessage('Edit article process started', {
    level: 'info',
    tags: {
      component: 'articles',
      action: 'process_start',
      api_endpoint: '/api/dashboard/blog/[id]/edit',
      entity: 'blog_article',
      operation: 'update',
    },
    extra: {
      requestId,
      articleId: id,
      timestamp: new Date().toISOString(),
      method: 'PUT',
    },
  });

  try {
    // ===== ÉTAPE 1: VALIDATION DE L'ID DE L'ARTICLE =====
    try {
      await articleIdSchema.validate({ id }, { abortEarly: false });
    } catch (idValidationError) {
      const errorCategory = categorizeError(idValidationError);

      logger.error('Article ID Validation Error', {
        category: errorCategory,
        articleId: id,
        validation_errors: idValidationError.inner?.map(
          (err) => err.message,
        ) || [idValidationError.message],
        requestId,
      });

      captureMessage('Article ID validation failed', {
        level: 'warning',
        tags: {
          component: 'articles',
          action: 'id_validation_failed',
          error_category: 'validation',
          entity: 'blog_article',
          operation: 'update',
        },
        extra: {
          requestId,
          articleId: id,
          validationErrors: idValidationError.inner?.map(
            (err) => err.message,
          ) || [idValidationError.message],
        },
      });

      const responseTime = Date.now() - startTime;
      const securityHeaders = getSecurityHeaders(requestId, responseTime, id);

      return NextResponse.json(
        {
          success: false,
          error: 'Invalid article ID format',
          details: idValidationError.inner?.map((err) => err.message) || [
            idValidationError.message,
          ],
          requestId,
        },
        {
          status: 400,
          headers: securityHeaders,
        },
      );
    }

    // ===== ÉTAPE 2: APPLIQUER LE RATE LIMITING =====
    const rateLimitResponse = await editArticleRateLimit(request);

    if (rateLimitResponse) {
      logger.warn('Edit article API rate limit exceeded', {
        requestId,
        articleId: id,
        ip: anonymizeIp(extractRealIp(request)),
      });

      captureMessage('Edit article API rate limit exceeded', {
        level: 'warning',
        tags: {
          component: 'articles',
          action: 'rate_limit_exceeded',
          error_category: 'rate_limiting',
          entity: 'blog_article',
          operation: 'update',
        },
        extra: {
          requestId,
          articleId: id,
          ip: anonymizeIp(extractRealIp(request)),
          userAgent:
            request.headers.get('user-agent')?.substring(0, 100) || 'unknown',
        },
      });

      const responseTime = Date.now() - startTime;
      const securityHeaders = getSecurityHeaders(requestId, responseTime, id);

      return new NextResponse(rateLimitResponse.body, {
        status: 429,
        headers: {
          ...Object.fromEntries(rateLimitResponse.headers.entries()),
          ...securityHeaders,
        },
      });
    }

    // ===== ÉTAPE 3: VÉRIFICATION AUTHENTIFICATION =====
    await isAuthenticatedUser(request, NextResponse);

    // ===== ÉTAPE 4: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Database Connection Error during article edit', {
        category: errorCategory,
        message: dbConnectionError.message,
        requestId,
        articleId: id,
      });

      captureDatabaseError(dbConnectionError, {
        tags: {
          component: 'articles',
          action: 'db_connection_failed',
          operation: 'connection',
          entity: 'blog_article',
        },
        extra: {
          requestId,
          articleId: id,
          timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
          ip: anonymizeIp(extractRealIp(request)),
          rateLimitingApplied: true,
        },
      });

      const responseTime = Date.now() - startTime;
      const securityHeaders = getSecurityHeaders(requestId, responseTime, id);

      return NextResponse.json(
        {
          success: false,
          error: 'Database connection failed',
          requestId,
        },
        {
          status: 503,
          headers: securityHeaders,
        },
      );
    }

    // ===== ÉTAPE 5: PARSING ET VALIDATION DU BODY =====
    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      const errorCategory = categorizeError(parseError);

      logger.error('JSON Parse Error during article edit', {
        category: errorCategory,
        message: parseError.message,
        requestId,
        articleId: id,
      });

      captureException(parseError, {
        level: 'error',
        tags: {
          component: 'articles',
          action: 'json_parse_error',
          error_category: categorizeError(parseError),
          operation: 'update',
        },
        extra: {
          requestId,
          articleId: id,
          contentType: request.headers.get('content-type'),
          userAgent: request.headers.get('user-agent')?.substring(0, 100),
        },
      });

      if (client) await client.cleanup();

      const responseTime = Date.now() - startTime;
      const securityHeaders = getSecurityHeaders(requestId, responseTime, id);

      return NextResponse.json(
        {
          success: false,
          error: 'Invalid JSON in request body',
          requestId,
        },
        {
          status: 400,
          headers: securityHeaders,
        },
      );
    }

    const { title, text, imageUrl, isActive, oldImageId } = body;

    // ===== ÉTAPE 6: SANITIZATION DES INPUTS =====
    const dataToSanitize = {
      title,
      text,
      imageUrl,
      isActive,
    };

    const filteredDataToSanitize = Object.fromEntries(
      Object.entries(dataToSanitize).filter(
        ([_, value]) => value !== undefined,
      ),
    );

    const sanitizedInputs = sanitizeUpdateArticleInputs(filteredDataToSanitize);

    const {
      title: sanitizedTitle,
      text: sanitizedText,
      imageUrl: sanitizedImageUrl,
      isActive: sanitizedIsActive,
    } = sanitizedInputs;

    const finalData = {
      title: sanitizedTitle,
      text: sanitizedText,
      imageUrl: sanitizedImageUrl,
      isActive: sanitizedIsActive,
      oldImageId, // Non sanitizé car utilisé pour la logique interne
    };

    // ===== ÉTAPE 7: VALIDATION AVEC YUP =====
    try {
      const dataToValidate = Object.fromEntries(
        Object.entries({
          title: sanitizedTitle,
          text: sanitizedText,
          imageUrl: sanitizedImageUrl,
          isActive: sanitizedIsActive,
        }).filter(([_, value]) => value !== undefined),
      );

      await updateArticleSchema.validate(dataToValidate, {
        abortEarly: false,
      });
    } catch (validationError) {
      const errorCategory = categorizeError(validationError);

      logger.error('Article Validation Error with Yup', {
        category: errorCategory,
        failed_fields: validationError.inner?.map((err) => err.path) || [],
        total_errors: validationError.inner?.length || 0,
        requestId,
        articleId: id,
      });

      captureMessage('Article validation failed with Yup schema', {
        level: 'warning',
        tags: {
          component: 'articles',
          action: 'yup_validation_failed',
          error_category: 'validation',
          entity: 'blog_article',
          operation: 'update',
        },
        extra: {
          requestId,
          articleId: id,
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
      const securityHeaders = getSecurityHeaders(requestId, responseTime, id);

      return NextResponse.json(
        {
          success: false,
          message: 'Validation failed',
          errors,
          requestId,
        },
        {
          status: 422,
          headers: securityHeaders,
        },
      );
    }

    // ===== ÉTAPE 8: GESTION DE L'IMAGE CLOUDINARY =====
    if (oldImageId && sanitizedImageUrl && oldImageId !== sanitizedImageUrl) {
      try {
        await cloudinary.uploader.destroy(oldImageId);
      } catch (cloudError) {
        logger.error('Error deleting old image from Cloudinary', {
          requestId,
          articleId: id,
          oldImageId,
          error: cloudError.message,
        });

        captureException(cloudError, {
          level: 'warning',
          tags: {
            component: 'articles',
            action: 'cloudinary_delete_failed',
            error_category: 'media_upload',
            entity: 'blog_article',
            operation: 'update',
          },
          extra: {
            requestId,
            articleId: id,
            oldImageId,
          },
        });
      }
    }

    // ===== ÉTAPE 9: MISE À JOUR EN BASE DE DONNÉES =====
    let result;
    try {
      const updateFields = [];
      const updateValues = [];
      let paramCounter = 1;

      if (sanitizedTitle !== undefined) {
        updateFields.push(`article_title = $${paramCounter}`);
        updateValues.push(sanitizedTitle);
        paramCounter++;
      }

      if (sanitizedText !== undefined) {
        updateFields.push(`article_text = $${paramCounter}`);
        updateValues.push(sanitizedText);
        paramCounter++;
      }

      if (sanitizedImageUrl !== undefined) {
        updateFields.push(`article_image = $${paramCounter}`);
        updateValues.push(sanitizedImageUrl);
        paramCounter++;
      }

      if (sanitizedIsActive !== undefined) {
        updateFields.push(`is_active = $${paramCounter}`);
        updateValues.push(sanitizedIsActive);
        paramCounter++;
      }

      updateFields.push(`article_updated = NOW()`);
      updateValues.push(id);

      const queryText = `
        UPDATE admin.articles 
        SET ${updateFields.join(', ')}
        WHERE article_id = $${paramCounter}
        RETURNING 
          article_id,
          article_title,
          article_text,
          article_image,
          is_active,
          TO_CHAR(article_created, 'DD/MM/YYYY') as created,
          TO_CHAR(article_updated, 'DD/MM/YYYY') as updated
      `;

      result = await client.query(queryText, updateValues);

      if (result.rows.length === 0) {
        logger.warn('Article not found for update', {
          requestId,
          articleId: id,
        });

        captureMessage('Article not found for update', {
          level: 'warning',
          tags: {
            component: 'articles',
            action: 'article_not_found',
            error_category: 'not_found',
            entity: 'blog_article',
            operation: 'update',
          },
          extra: {
            requestId,
            articleId: id,
            ip: anonymizeIp(extractRealIp(request)),
          },
        });

        if (client) await client.cleanup();

        const responseTime = Date.now() - startTime;
        const securityHeaders = getSecurityHeaders(requestId, responseTime, id);

        return NextResponse.json(
          {
            success: false,
            message: 'Article not found',
            requestId,
          },
          {
            status: 404,
            headers: securityHeaders,
          },
        );
      }
    } catch (updateError) {
      const errorCategory = categorizeError(updateError);

      logger.error('Article Update Error', {
        category: errorCategory,
        message: updateError.message,
        requestId,
        articleId: id,
      });

      captureDatabaseError(updateError, {
        tags: {
          component: 'articles',
          action: 'update_failed',
          operation: 'UPDATE',
          entity: 'blog_article',
        },
        extra: {
          requestId,
          articleId: id,
          table: 'admin.articles',
          queryType: 'article_update',
          postgresCode: updateError.code,
          postgresDetail: updateError.detail ? '[Filtered]' : undefined,
          ip: anonymizeIp(extractRealIp(request)),
          rateLimitingApplied: true,
        },
      });

      if (client) await client.cleanup();

      const responseTime = Date.now() - startTime;
      const securityHeaders = getSecurityHeaders(requestId, responseTime, id);

      return NextResponse.json(
        {
          success: false,
          error: 'Failed to update article',
          message: updateError.message,
          requestId,
        },
        {
          status: 500,
          headers: securityHeaders,
        },
      );
    }

    // ===== ÉTAPE 10: INVALIDATION DU CACHE APRÈS SUCCÈS =====
    const updatedArticle = result.rows[0];
    const cacheInvalidation = invalidateArticlesCache(requestId, id);

    // ===== ÉTAPE 11: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Article update successful', {
      articleId: id,
      articleTitle: updatedArticle.article_title,
      response_time_ms: responseTime,
      success: true,
      requestId,
    });

    captureMessage('Article update completed successfully', {
      level: 'info',
      tags: {
        component: 'articles',
        action: 'update_success',
        success: 'true',
        entity: 'blog_article',
        operation: 'update',
      },
      extra: {
        requestId,
        articleId: id,
        articleTitle: updatedArticle.article_title,
        responseTimeMs: responseTime,
        databaseOperations: 3,
        cacheInvalidated:
          cacheInvalidation.listInvalidated ||
          cacheInvalidation.singleInvalidated,
        ip: anonymizeIp(extractRealIp(request)),
        rateLimitingApplied: true,
        sanitizationApplied: true,
        yupValidationApplied: true,
      },
    });

    if (client) await client.cleanup();

    const securityHeaders = getSecurityHeaders(requestId, responseTime, id);

    return NextResponse.json(
      {
        success: true,
        message: 'Article updated successfully',
        data: updatedArticle,
        meta: {
          requestId,
          timestamp: new Date().toISOString(),
          fieldsUpdated: Object.keys(finalData).filter(
            (key) => finalData[key] !== undefined && key !== 'oldImageId',
          ).length,
        },
      },
      {
        status: 200,
        headers: securityHeaders,
      },
    );
  } catch (error) {
    // ===== GESTION GLOBALE DES ERREURS =====
    const errorCategory = categorizeError(error);
    const responseTime = Date.now() - startTime;

    logger.error('Global Edit Article Error', {
      category: errorCategory,
      response_time_ms: responseTime,
      error_message: error.message,
      requestId,
      articleId: id,
    });

    captureException(error, {
      level: 'error',
      tags: {
        component: 'articles',
        action: 'global_error_handler',
        error_category: errorCategory,
        critical: 'true',
        entity: 'blog_article',
        operation: 'update',
      },
      extra: {
        requestId,
        articleId: id,
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'article_update',
        ip: anonymizeIp(extractRealIp(request)),
        rateLimitingApplied: true,
      },
    });

    if (client) await client.cleanup();

    const securityHeaders = getSecurityHeaders(requestId, responseTime, id);

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: 'Failed to update article',
        requestId,
      },
      {
        status: 500,
        headers: securityHeaders,
      },
    );
  }
}
