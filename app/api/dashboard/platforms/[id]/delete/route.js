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
import { articleIdSchema } from '@/utils/schemas/articleSchema';
import { dashboardCache, getDashboardCacheKey } from '@/utils/cache';

export const dynamic = 'force-dynamic';

// Créer le middleware de rate limiting spécifique pour la suppression d'articles
const deleteArticleRateLimit = applyRateLimit('CONTENT_API', {
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 8, // 8 suppressions par 5 minutes
  message:
    "Trop de tentatives de suppression d'articles. Veuillez réessayer dans quelques minutes.",
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
  prefix: 'delete_article',

  keyGenerator: (req) => {
    const ip = extractRealIp(req);
    const url = req.url || req.nextUrl?.pathname || '';
    const articleIdMatch = url.match(/blog\/([^/]+)\/delete/);
    const articleId = articleIdMatch ? articleIdMatch[1] : 'unknown';
    return `delete_article:ip:${ip}:article:${articleId}`;
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

    captureMessage('Articles cache invalidated after deletion', {
      level: 'info',
      tags: {
        component: 'articles',
        action: 'cache_invalidation',
        entity: 'blog_article',
        operation: 'delete',
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
        operation: 'delete',
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
    'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
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
    'X-Operation-Type': 'delete',
    'X-Cache-Invalidation': 'articles',
    'X-Rate-Limiting-Applied': 'true',
    'X-Irreversible-Operation': 'true',
    'X-Data-Loss-Warning': 'permanent',
    'X-RateLimit-Window': '300',
    'X-RateLimit-Limit': '8',
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

export async function DELETE(request, { params }) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();
  const { id } = params;

  logger.info('Delete Article API called', {
    requestId,
    articleId: id,
  });

  captureMessage('Delete article process started', {
    level: 'info',
    tags: {
      component: 'articles',
      action: 'process_start',
      api_endpoint: '/api/dashboard/blog/[id]/delete',
      entity: 'blog_article',
      operation: 'delete',
    },
    extra: {
      requestId,
      articleId: id,
      timestamp: new Date().toISOString(),
      method: 'DELETE',
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
          operation: 'delete',
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
          message: 'This article does not exist',
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
    const rateLimitResponse = await deleteArticleRateLimit(request);

    if (rateLimitResponse) {
      logger.warn('Delete article API rate limit exceeded', {
        requestId,
        articleId: id,
        ip: anonymizeIp(extractRealIp(request)),
      });

      captureMessage('Delete article API rate limit exceeded', {
        level: 'warning',
        tags: {
          component: 'articles',
          action: 'rate_limit_exceeded',
          error_category: 'rate_limiting',
          entity: 'blog_article',
          operation: 'delete',
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

      logger.error('Database Connection Error during article deletion', {
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

    // ===== ÉTAPE 5: PARSING DU BODY POUR L'IMAGE ID =====
    let body;
    let imageID = null;

    try {
      body = await request.json();
      imageID = body.imageID;
    } catch (parseError) {
      // Le body n'est pas obligatoire pour la suppression, continuer sans imageID
    }

    // ===== ÉTAPE 6: VÉRIFICATION DE L'EXISTENCE ET DE L'ÉTAT DE L'ARTICLE =====
    let articleToDelete;
    try {
      const checkResult = await client.query(
        'SELECT article_id, article_title, article_image, is_active FROM admin.articles WHERE article_id = $1',
        [id],
      );

      if (checkResult.rows.length === 0) {
        logger.warn('Article not found for deletion', {
          requestId,
          articleId: id,
        });

        captureMessage('Article not found for deletion', {
          level: 'warning',
          tags: {
            component: 'articles',
            action: 'article_not_found',
            error_category: 'not_found',
            entity: 'blog_article',
            operation: 'delete',
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
            message: 'This article does not exist',
            requestId,
          },
          {
            status: 404,
            headers: securityHeaders,
          },
        );
      }

      articleToDelete = checkResult.rows[0];

      // Vérifier que l'article est inactif (condition obligatoire pour la suppression)
      if (articleToDelete.is_active === true) {
        logger.warn('Attempted to delete active article', {
          requestId,
          articleId: id,
          articleTitle: articleToDelete.article_title,
          isActive: articleToDelete.is_active,
        });

        captureMessage('Attempted to delete active article', {
          level: 'warning',
          tags: {
            component: 'articles',
            action: 'active_article_deletion_blocked',
            error_category: 'business_rule_violation',
            entity: 'blog_article',
            operation: 'delete',
          },
          extra: {
            requestId,
            articleId: id,
            articleTitle: articleToDelete.article_title,
            isActive: articleToDelete.is_active,
            ip: anonymizeIp(extractRealIp(request)),
          },
        });

        if (client) await client.cleanup();

        const responseTime = Date.now() - startTime;
        const securityHeaders = getSecurityHeaders(requestId, responseTime, id);

        return NextResponse.json(
          {
            success: false,
            message:
              'Cannot delete active article. Please deactivate the article first.',
            error: 'Article is currently active',
          },
          {
            status: 400,
            headers: securityHeaders,
          },
        );
      }
    } catch (checkError) {
      const errorCategory = categorizeError(checkError);

      logger.error('Article Check Error', {
        category: errorCategory,
        message: checkError.message,
        requestId,
        articleId: id,
      });

      captureDatabaseError(checkError, {
        tags: {
          component: 'articles',
          action: 'article_check_failed',
          operation: 'SELECT',
          entity: 'blog_article',
        },
        extra: {
          requestId,
          articleId: id,
          table: 'admin.articles',
          queryType: 'article_existence_check',
          postgresCode: checkError.code,
          ip: anonymizeIp(extractRealIp(request)),
        },
      });

      if (client) await client.cleanup();

      const responseTime = Date.now() - startTime;
      const securityHeaders = getSecurityHeaders(requestId, responseTime, id);

      return NextResponse.json(
        {
          success: false,
          error: 'Failed to verify article status',
          message: 'Something went wrong! Please try again',
          requestId,
        },
        {
          status: 500,
          headers: securityHeaders,
        },
      );
    }

    // ===== ÉTAPE 7: SUPPRESSION DE L'ARTICLE EN BASE DE DONNÉES =====
    let deleteResult;
    try {
      // Supprimer uniquement si is_active = false (sécurité supplémentaire)
      deleteResult = await client.query(
        `DELETE FROM admin.articles 
        WHERE article_id = $1
        AND is_active = false
        RETURNING article_title, article_image`,
        [id],
      );

      if (deleteResult.rowCount === 0) {
        logger.error('Article deletion failed - no rows affected', {
          requestId,
          articleId: id,
        });

        captureMessage('Article deletion failed - no rows affected', {
          level: 'error',
          tags: {
            component: 'articles',
            action: 'deletion_no_rows_affected',
            error_category: 'database_inconsistency',
            entity: 'blog_article',
            operation: 'delete',
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
            message:
              'Article could not be deleted. It may be active or already deleted.',
            error: 'Deletion condition not met',
            requestId,
          },
          {
            status: 400,
            headers: securityHeaders,
          },
        );
      }
    } catch (deleteError) {
      const errorCategory = categorizeError(deleteError);

      logger.error('Article Deletion Error', {
        category: errorCategory,
        message: deleteError.message,
        requestId,
        articleId: id,
      });

      captureDatabaseError(deleteError, {
        tags: {
          component: 'articles',
          action: 'deletion_failed',
          operation: 'DELETE',
          entity: 'blog_article',
        },
        extra: {
          requestId,
          articleId: id,
          table: 'admin.articles',
          queryType: 'article_deletion',
          postgresCode: deleteError.code,
          postgresDetail: deleteError.detail ? '[Filtered]' : undefined,
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
          error: 'Failed to delete article from database',
          message: 'Something went wrong! Please try again',
          requestId,
        },
        {
          status: 500,
          headers: securityHeaders,
        },
      );
    }

    // ===== ÉTAPE 8: SUPPRESSION DE L'IMAGE CLOUDINARY =====
    const deletedArticle = deleteResult.rows[0];
    const cloudinaryImageId =
      imageID || articleToDelete.article_image || deletedArticle.article_image;

    if (cloudinaryImageId) {
      try {
        await cloudinary.uploader.destroy(cloudinaryImageId);
      } catch (cloudError) {
        logger.error('Error deleting image from Cloudinary', {
          requestId,
          articleId: id,
          imageId: cloudinaryImageId,
          error: cloudError.message,
        });

        captureException(cloudError, {
          level: 'warning',
          tags: {
            component: 'articles',
            action: 'cloudinary_delete_failed',
            error_category: 'media_upload',
            entity: 'blog_article',
            operation: 'delete',
          },
          extra: {
            requestId,
            articleId: id,
            imageId: cloudinaryImageId,
            articleAlreadyDeleted: true,
          },
        });
      }
    }

    // ===== ÉTAPE 9: INVALIDATION DU CACHE APRÈS SUCCÈS =====
    const cacheInvalidation = invalidateArticlesCache(requestId, id);

    // ===== ÉTAPE 10: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Article deletion successful', {
      articleId: id,
      articleTitle: deletedArticle.article_title,
      response_time_ms: responseTime,
      success: true,
      requestId,
    });

    captureMessage('Article deletion completed successfully', {
      level: 'info',
      tags: {
        component: 'articles',
        action: 'deletion_success',
        success: 'true',
        entity: 'blog_article',
        operation: 'delete',
      },
      extra: {
        requestId,
        articleId: id,
        articleTitle: deletedArticle.article_title,
        imageId: cloudinaryImageId,
        responseTimeMs: responseTime,
        databaseOperations: 3,
        cloudinaryOperations: cloudinaryImageId ? 1 : 0,
        cacheInvalidated: cacheInvalidation.listInvalidated,
        ip: anonymizeIp(extractRealIp(request)),
        rateLimitingApplied: true,
      },
    });

    if (client) await client.cleanup();

    const securityHeaders = getSecurityHeaders(requestId, responseTime, id);

    return NextResponse.json(
      {
        success: true,
        message: 'Article and associated image deleted successfully',
        article: {
          id: id,
          title: deletedArticle.article_title,
        },
        meta: {
          requestId,
          timestamp: new Date().toISOString(),
          imageDeleted: !!cloudinaryImageId,
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

    logger.error('Global Delete Article Error', {
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
        operation: 'delete',
      },
      extra: {
        requestId,
        articleId: id,
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'article_deletion',
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
        message: 'Something went wrong! Please try again',
        requestId,
      },
      {
        status: 500,
        headers: securityHeaders,
      },
    );
  }
}
