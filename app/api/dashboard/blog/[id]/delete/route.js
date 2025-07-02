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

// ----- CONFIGURATION DU RATE LIMITING POUR LA SUPPRESSION D'ARTICLES -----

// Créer le middleware de rate limiting spécifique pour la suppression d'articles
const deleteArticleRateLimit = applyRateLimit('CONTENT_API', {
  // Configuration personnalisée pour la suppression d'articles
  windowMs: 5 * 60 * 1000, // 5 minutes (plus strict pour les suppressions)
  max: 8, // 8 suppressions par 5 minutes (plus restrictif que templates car contenu plus sensible)
  message:
    "Trop de tentatives de suppression d'articles. Veuillez réessayer dans quelques minutes.",
  skipSuccessfulRequests: false, // Compter toutes les suppressions réussies
  skipFailedRequests: false, // Compter aussi les échecs
  prefix: 'delete_article', // Préfixe spécifique pour la suppression d'articles

  // Fonction personnalisée pour générer la clé (basée sur IP + ID de l'article)
  keyGenerator: (req) => {
    const ip = extractRealIp(req);
    const url = req.url || req.nextUrl?.pathname || '';
    const articleIdMatch = url.match(/blog\/([^/]+)\/delete/);
    const articleId = articleIdMatch ? articleIdMatch[1] : 'unknown';
    return `delete_article:ip:${ip}:article:${articleId}`;
  },
});

// ----- FONCTION D'INVALIDATION DU CACHE -----
const invalidateArticlesCache = (requestId, articleId) => {
  try {
    // Invalider le cache de la liste des articles
    const listCacheKey = getDashboardCacheKey('articles_list', {
      endpoint: 'dashboard_articles',
      version: '1.0',
    });

    const listCacheInvalidated =
      dashboardCache.blogArticles.delete(listCacheKey);

    logger.debug('Articles cache invalidation', {
      requestId,
      articleId,
      component: 'articles',
      action: 'cache_invalidation',
      operation: 'delete_article',
      listCacheKey,
      listInvalidated: listCacheInvalidated,
    });

    // Capturer l'invalidation du cache avec Sentry
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
      component: 'articles',
      action: 'cache_invalidation_failed',
      operation: 'delete_article',
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

// ----- FONCTION POUR GÉNÉRER LES HEADERS DE SÉCURITÉ -----
const getSecurityHeaders = (requestId, responseTime, articleId) => {
  return {
    // ===== CORS SPÉCIFIQUE (même site uniquement) =====
    'Access-Control-Allow-Origin':
      process.env.NEXT_PUBLIC_SITE_URL || 'same-origin',
    'Access-Control-Allow-Methods': 'DELETE, OPTIONS', // Spécifique à la suppression
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-Requested-With',

    // ===== ANTI-CACHE STRICT (mutations sensibles) =====
    'Cache-Control':
      'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',
    'Surrogate-Control': 'no-store',

    // ===== SÉCURITÉ RENFORCÉE =====
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',

    // ===== ISOLATION ET POLICIES =====
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Resource-Policy': 'same-site',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless',

    // ===== CSP POUR MANIPULATION DE DONNÉES =====
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'",

    // ===== PERMISSIONS LIMITÉES =====
    'Permissions-Policy':
      'geolocation=(), microphone=(), camera=(), payment=(), usb=()',

    // ===== HEADERS INFORMATIFS SPÉCIFIQUES BLOG DELETE =====
    'X-API-Version': '1.0',
    'X-Transaction-Type': 'mutation',
    'X-Entity-Type': 'blog-article',
    'X-Operation-Type': 'delete', // Spécifique à la suppression

    // ===== HEADERS MÉTIER DELETE =====
    'X-Cache-Invalidation': 'articles',
    'X-Rate-Limiting-Applied': 'true',

    // ===== HEADERS SPÉCIFIQUES À LA SUPPRESSION =====
    'X-Resource-Validation': 'article-id-required',
    'X-UUID-Validation': 'cleaned-and-verified',
    'X-Media-Management': 'cloudinary-full-cleanup',
    'X-Business-Rule-Validation': 'inactive-only',
    'X-Operation-Criticality': 'high', // Plus critique que edit
    'X-Validation-Steps': 'business-rules',
    'X-Resource-State-Check': 'required',

    // ===== HEADERS D'AVERTISSEMENT SPÉCIFIQUES =====
    'X-Irreversible-Operation': 'true',
    'X-Data-Loss-Warning': 'permanent',

    // ===== RATE LIMITING SPÉCIFIQUE DELETE =====
    'X-RateLimit-Window': '300', // 5 minutes (strict comme add)
    'X-RateLimit-Limit': '8', // 8 suppressions par 5 minutes

    // ===== SÉCURITÉ SUPPLÉMENTAIRE =====
    'X-Permitted-Cross-Domain-Policies': 'none',
    'X-Robots-Tag': 'noindex, nofollow',
    Vary: 'Authorization, Content-Type',

    // ===== HEADERS DE TRAÇABILITÉ =====
    'X-Request-ID': requestId,
    'X-Response-Time': `${responseTime}ms`,
    'X-Content-Category': 'blog-content',
    'X-Database-Operations': '3', // connection + check + delete
    'X-Resource-ID': articleId,
  };
};

// ----- API ROUTE PRINCIPALE AVEC RATE LIMITING -----

export async function DELETE(request, { params }) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();
  const { id } = params;

  logger.info('Delete Article API called', {
    timestamp: new Date().toISOString(),
    requestId,
    articleId: id,
    component: 'articles',
    action: 'api_start',
    method: 'DELETE',
    operation: 'delete_article',
  });

  // Capturer le début du processus de suppression d'article
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
    logger.debug('Validating article ID', {
      requestId,
      articleId: id,
      component: 'articles',
      action: 'id_validation_start',
      operation: 'delete_article',
    });

    try {
      await articleIdSchema.validate({ id }, { abortEarly: false });

      logger.debug('Article ID validation passed', {
        requestId,
        articleId: id,
        component: 'articles',
        action: 'id_validation_success',
        operation: 'delete_article',
      });
    } catch (idValidationError) {
      const errorCategory = categorizeError(idValidationError);

      logger.error('Article ID Validation Error', {
        category: errorCategory,
        articleId: id,
        validation_errors: idValidationError.inner?.map(
          (err) => err.message,
        ) || [idValidationError.message],
        requestId,
        component: 'articles',
        action: 'id_validation_failed',
        operation: 'delete_article',
      });

      // Capturer l'erreur de validation d'ID avec Sentry
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
    logger.debug('Applying rate limiting for delete article API', {
      requestId,
      articleId: id,
      component: 'articles',
      action: 'rate_limit_start',
      operation: 'delete_article',
    });

    const rateLimitResponse = await deleteArticleRateLimit(request);

    // Si le rate limiter retourne une réponse, cela signifie que la limite est dépassée
    if (rateLimitResponse) {
      logger.warn('Delete article API rate limit exceeded', {
        requestId,
        articleId: id,
        component: 'articles',
        action: 'rate_limit_exceeded',
        operation: 'delete_article',
        ip: anonymizeIp(extractRealIp(request)),
      });

      // Capturer l'événement de rate limiting avec Sentry
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

      // Ajouter les headers de sécurité même en cas de rate limiting
      const responseTime = Date.now() - startTime;
      const securityHeaders = getSecurityHeaders(requestId, responseTime, id);

      // Créer une nouvelle réponse avec les headers de sécurité
      return new NextResponse(rateLimitResponse.body, {
        status: 429,
        headers: {
          ...Object.fromEntries(rateLimitResponse.headers.entries()),
          ...securityHeaders,
        },
      });
    }

    logger.debug('Rate limiting passed successfully', {
      requestId,
      articleId: id,
      component: 'articles',
      action: 'rate_limit_passed',
      operation: 'delete_article',
    });

    // ===== ÉTAPE 3: VÉRIFICATION AUTHENTIFICATION =====
    logger.debug('Verifying user authentication', {
      requestId,
      articleId: id,
      component: 'articles',
      action: 'auth_verification_start',
      operation: 'delete_article',
    });

    await isAuthenticatedUser(request, NextResponse);

    logger.debug('User authentication verified successfully', {
      requestId,
      articleId: id,
      component: 'articles',
      action: 'auth_verification_success',
      operation: 'delete_article',
    });

    // ===== ÉTAPE 4: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
      logger.debug('Database connection successful', {
        requestId,
        articleId: id,
        component: 'articles',
        action: 'db_connection_success',
        operation: 'delete_article',
      });
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Database Connection Error during article deletion', {
        category: errorCategory,
        message: dbConnectionError.message,
        timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
        requestId,
        articleId: id,
        component: 'articles',
        action: 'db_connection_failed',
        operation: 'delete_article',
      });

      // Capturer l'erreur de connexion DB avec Sentry
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

      logger.debug('Request body parsed successfully', {
        requestId,
        articleId: id,
        hasImageID: !!imageID,
        component: 'articles',
        action: 'body_parse_success',
        operation: 'delete_article',
      });
    } catch (parseError) {
      // Le body n'est pas obligatoire pour la suppression, continuer sans imageID
      logger.debug('No valid JSON body provided, continuing without imageID', {
        requestId,
        articleId: id,
        component: 'articles',
        action: 'body_parse_optional',
        operation: 'delete_article',
      });
    }

    // ===== ÉTAPE 6: VÉRIFICATION DE L'EXISTENCE ET DE L'ÉTAT DE L'ARTICLE =====
    let articleToDelete;
    try {
      logger.debug('Checking article existence and status', {
        requestId,
        articleId: id,
        component: 'articles',
        action: 'article_check_start',
        operation: 'delete_article',
      });

      const checkResult = await client.query(
        'SELECT article_id, article_title, article_image, is_active FROM admin.articles WHERE article_id = $1',
        [id],
      );

      if (checkResult.rows.length === 0) {
        logger.warn('Article not found for deletion', {
          requestId,
          articleId: id,
          component: 'articles',
          action: 'article_not_found',
          operation: 'delete_article',
        });

        // Capturer l'article non trouvé avec Sentry
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

      // NOUVELLE VÉRIFICATION: Vérifier que l'article est inactif (condition obligatoire pour la suppression)
      if (articleToDelete.is_active === true) {
        logger.warn('Attempted to delete active article', {
          requestId,
          articleId: id,
          articleTitle: articleToDelete.article_title,
          isActive: articleToDelete.is_active,
          component: 'articles',
          action: 'active_article_deletion_blocked',
          operation: 'delete_article',
        });

        // Capturer la tentative de suppression d'un article actif avec Sentry
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

      logger.debug('Article validation passed - inactive article found', {
        requestId,
        articleId: id,
        articleTitle: articleToDelete.article_title,
        isActive: articleToDelete.is_active,
        hasImage: !!articleToDelete.article_image,
        component: 'articles',
        action: 'article_check_success',
        operation: 'delete_article',
      });
    } catch (checkError) {
      const errorCategory = categorizeError(checkError);

      logger.error('Article Check Error', {
        category: errorCategory,
        message: checkError.message,
        requestId,
        articleId: id,
        component: 'articles',
        action: 'article_check_failed',
        operation: 'delete_article',
      });

      // Capturer l'erreur de vérification avec Sentry
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
      logger.debug('Executing article deletion query', {
        requestId,
        articleId: id,
        component: 'articles',
        action: 'query_start',
        operation: 'delete_article',
        table: 'admin.articles',
      });

      // MODIFICATION: Supprimer uniquement si is_active = false (sécurité supplémentaire)
      deleteResult = await client.query(
        `DELETE FROM admin.articles 
        WHERE article_id = $1
        AND is_active = false
        RETURNING article_title, article_image`,
        [id],
      );

      if (deleteResult.rowCount === 0) {
        // Cela ne devrait pas arriver après nos vérifications, mais sécurité supplémentaire
        logger.error('Article deletion failed - no rows affected', {
          requestId,
          articleId: id,
          component: 'articles',
          action: 'deletion_no_rows_affected',
          operation: 'delete_article',
        });

        // Capturer l'échec inattendu avec Sentry
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

      logger.debug('Article deletion query executed successfully', {
        requestId,
        articleId: id,
        articleTitle: deleteResult.rows[0].article_title,
        component: 'articles',
        action: 'query_success',
        operation: 'delete_article',
      });
    } catch (deleteError) {
      const errorCategory = categorizeError(deleteError);

      logger.error('Article Deletion Error', {
        category: errorCategory,
        message: deleteError.message,
        operation: 'DELETE FROM admin.articles',
        table: 'admin.articles',
        requestId,
        articleId: id,
        component: 'articles',
        action: 'query_failed',
      });

      // Capturer l'erreur de suppression avec Sentry
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
        logger.debug('Deleting image from Cloudinary', {
          requestId,
          articleId: id,
          imageId: cloudinaryImageId,
          component: 'articles',
          action: 'cloudinary_delete_start',
          operation: 'delete_article',
        });

        await cloudinary.uploader.destroy(cloudinaryImageId);

        logger.debug('Image deleted from Cloudinary successfully', {
          requestId,
          articleId: id,
          imageId: cloudinaryImageId,
          component: 'articles',
          action: 'cloudinary_delete_success',
          operation: 'delete_article',
        });
      } catch (cloudError) {
        logger.error('Error deleting image from Cloudinary', {
          requestId,
          articleId: id,
          imageId: cloudinaryImageId,
          error: cloudError.message,
          component: 'articles',
          action: 'cloudinary_delete_failed',
          operation: 'delete_article',
        });

        // Capturer l'erreur Cloudinary avec Sentry (non critique car l'article est déjà supprimé)
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
        // Ne pas faire échouer la suppression si Cloudinary échoue
      }
    } else {
      logger.debug('No image to delete from Cloudinary', {
        requestId,
        articleId: id,
        component: 'articles',
        action: 'cloudinary_no_image',
        operation: 'delete_article',
      });
    }

    // ===== ÉTAPE 9: INVALIDATION DU CACHE APRÈS SUCCÈS =====
    // Invalider le cache des articles après suppression réussie
    const cacheInvalidation = invalidateArticlesCache(requestId, id);

    // ===== ÉTAPE 10: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Article deletion successful', {
      articleId: id,
      articleTitle: deletedArticle.article_title,
      imageId: cloudinaryImageId,
      response_time_ms: responseTime,
      database_operations: 3, // connection + check + delete
      cloudinary_operations: cloudinaryImageId ? 1 : 0,
      cache_invalidated:
        cacheInvalidation.listInvalidated ||
        cacheInvalidation.singleInvalidated,
      success: true,
      requestId,
      component: 'articles',
      action: 'deletion_success',
      entity: 'blog_article',
      rateLimitingApplied: true,
      operation: 'delete_article',
    });

    // Capturer le succès de la suppression avec Sentry
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

    // Générer les headers de sécurité pour la réponse de succès
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
      reached_global_handler: true,
      error_name: error.name,
      error_message: error.message,
      stack_available: !!error.stack,
      requestId,
      articleId: id,
      component: 'articles',
      action: 'global_error_handler',
      entity: 'blog_article',
      operation: 'delete_article',
    });

    // Capturer l'erreur globale avec Sentry
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

    // Générer les headers de sécurité même en cas d'erreur globale
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
