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

// Force dynamic pour éviter la mise en cache statique
export const dynamic = 'force-dynamic';

// ----- CONFIGURATION DU RATE LIMITING POUR LA MODIFICATION D'ARTICLES -----

// Créer le middleware de rate limiting spécifique pour la modification d'articles
const editArticleRateLimit = applyRateLimit('CONTENT_API', {
  // Configuration personnalisée pour la modification d'articles
  windowMs: 2 * 60 * 1000, // 2 minutes
  max: 15, // 15 modifications par 2 minutes (plus restrictif que templates car contenu plus lourd)
  message:
    "Trop de tentatives de modification d'articles. Veuillez réessayer dans quelques minutes.",
  skipSuccessfulRequests: false, // Compter toutes les modifications réussies
  skipFailedRequests: false, // Compter aussi les échecs
  prefix: 'edit_article', // Préfixe spécifique pour la modification d'articles

  // Fonction personnalisée pour générer la clé (basée sur IP + ID de l'article)
  keyGenerator: (req) => {
    const ip = extractRealIp(req);
    const url = req.url || req.nextUrl?.pathname || '';
    const articleIdMatch = url.match(/blog\/([^/]+)\/edit/);
    const articleId = articleIdMatch ? articleIdMatch[1] : 'unknown';
    return `edit_article:ip:${ip}:article:${articleId}`;
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
      operation: 'edit_article',
      listCacheKey,
      listInvalidated: listCacheInvalidated,
    });

    // Capturer l'invalidation du cache avec Sentry
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
      component: 'articles',
      action: 'cache_invalidation_failed',
      operation: 'edit_article',
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

// ----- FONCTION POUR GÉNÉRER LES HEADERS DE SÉCURITÉ -----
const getSecurityHeaders = (requestId, responseTime, articleId) => {
  return {
    // ===== CORS SPÉCIFIQUE (même site uniquement) =====
    'Access-Control-Allow-Origin':
      process.env.NEXT_PUBLIC_SITE_URL || 'same-origin',
    'Access-Control-Allow-Methods': 'PUT, OPTIONS', // Spécifique à l'édition
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

    // ===== HEADERS INFORMATIFS SPÉCIFIQUES BLOG EDIT =====
    'X-API-Version': '1.0',
    'X-Transaction-Type': 'mutation',
    'X-Entity-Type': 'blog-article',
    'X-Operation-Type': 'update', // Spécifique à l'édition

    // ===== HEADERS MÉTIER EDIT =====
    'X-Cache-Invalidation': 'articles',
    'X-Sanitization-Applied': 'true',
    'X-Yup-Validation-Applied': 'true',
    'X-Rate-Limiting-Applied': 'true',

    // ===== HEADERS SPÉCIFIQUES À L'ÉDITION =====
    'X-Resource-Validation': 'article-id-required',
    'X-UUID-Validation': 'cleaned-and-verified',
    'X-Media-Management': 'cloudinary-cleanup',
    'X-Partial-Update': 'enabled',
    'X-Business-Rules': 'partial-update-allowed',
    'X-Operation-Criticality': 'medium',

    // ===== RATE LIMITING SPÉCIFIQUE EDIT =====
    'X-RateLimit-Window': '120', // 2 minutes
    'X-RateLimit-Limit': '15', // 15 modifications par 2 minutes

    // ===== SÉCURITÉ SUPPLÉMENTAIRE =====
    'X-Permitted-Cross-Domain-Policies': 'none',
    'X-Robots-Tag': 'noindex, nofollow',
    Vary: 'Authorization, Content-Type',

    // ===== HEADERS DE TRAÇABILITÉ =====
    'X-Request-ID': requestId,
    'X-Response-Time': `${responseTime}ms`,
    'X-Content-Category': 'blog-content',
    'X-Database-Operations': '3', // connection + select + update
    'X-Resource-ID': articleId,
  };
};

// ----- API ROUTE PRINCIPALE AVEC RATE LIMITING -----

export async function PUT(request, { params }) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();
  const { id } = params;

  logger.info('Edit Article API called', {
    timestamp: new Date().toISOString(),
    requestId,
    articleId: id,
    component: 'articles',
    action: 'api_start',
    method: 'PUT',
    operation: 'edit_article',
  });

  // Capturer le début du processus de modification d'article
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
    logger.debug('Validating article ID', {
      requestId,
      articleId: id,
      component: 'articles',
      action: 'id_validation_start',
      operation: 'edit_article',
    });

    try {
      await articleIdSchema.validate({ id }, { abortEarly: false });

      logger.debug('Article ID validation passed', {
        requestId,
        articleId: id,
        component: 'articles',
        action: 'id_validation_success',
        operation: 'edit_article',
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
        operation: 'edit_article',
      });

      // Capturer l'erreur de validation d'ID avec Sentry
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
    logger.debug('Applying rate limiting for edit article API', {
      requestId,
      articleId: id,
      component: 'articles',
      action: 'rate_limit_start',
      operation: 'edit_article',
    });

    const rateLimitResponse = await editArticleRateLimit(request);

    // Si le rate limiter retourne une réponse, cela signifie que la limite est dépassée
    if (rateLimitResponse) {
      logger.warn('Edit article API rate limit exceeded', {
        requestId,
        articleId: id,
        component: 'articles',
        action: 'rate_limit_exceeded',
        operation: 'edit_article',
        ip: anonymizeIp(extractRealIp(request)),
      });

      // Capturer l'événement de rate limiting avec Sentry
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
      operation: 'edit_article',
    });

    // ===== ÉTAPE 3: VÉRIFICATION AUTHENTIFICATION =====
    logger.debug('Verifying user authentication', {
      requestId,
      articleId: id,
      component: 'articles',
      action: 'auth_verification_start',
      operation: 'edit_article',
    });

    await isAuthenticatedUser(request, NextResponse);

    logger.debug('User authentication verified successfully', {
      requestId,
      articleId: id,
      component: 'articles',
      action: 'auth_verification_success',
      operation: 'edit_article',
    });

    // ===== ÉTAPE 4: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
      logger.debug('Database connection successful', {
        requestId,
        articleId: id,
        component: 'articles',
        action: 'db_connection_success',
        operation: 'edit_article',
      });
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Database Connection Error during article edit', {
        category: errorCategory,
        message: dbConnectionError.message,
        timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
        requestId,
        articleId: id,
        component: 'articles',
        action: 'db_connection_failed',
        operation: 'edit_article',
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

    // ===== ÉTAPE 5: PARSING ET VALIDATION DU BODY =====
    let body;
    try {
      body = await request.json();
      logger.debug('Request body parsed successfully', {
        requestId,
        articleId: id,
        component: 'articles',
        action: 'body_parse_success',
        operation: 'edit_article',
      });
    } catch (parseError) {
      const errorCategory = categorizeError(parseError);

      logger.error('JSON Parse Error during article edit', {
        category: errorCategory,
        message: parseError.message,
        requestId,
        articleId: id,
        component: 'articles',
        action: 'json_parse_error',
        operation: 'edit_article',
        headers: {
          'content-type': request.headers.get('content-type'),
          'user-agent': request.headers.get('user-agent')?.substring(0, 100),
        },
      });

      // Capturer l'erreur de parsing avec Sentry
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

    logger.debug('Article data extracted from request', {
      requestId,
      articleId: id,
      component: 'articles',
      action: 'data_extraction',
      operation: 'edit_article',
      hasTitle: !!title,
      hasText: !!text,
      hasImageUrl: !!imageUrl,
      hasIsActive: isActive !== undefined,
      hasOldImageId: !!oldImageId,
    });

    // ===== ÉTAPE 6: SANITIZATION DES INPUTS =====
    logger.debug('Sanitizing article inputs', {
      requestId,
      articleId: id,
      component: 'articles',
      action: 'input_sanitization',
      operation: 'edit_article',
    });

    // Préparer les données pour la sanitization
    const dataToSanitize = {
      title,
      text,
      imageUrl,
      isActive,
    };

    // Filtrer les valeurs undefined pour la sanitization
    const filteredDataToSanitize = Object.fromEntries(
      Object.entries(dataToSanitize).filter(
        ([_, value]) => value !== undefined,
      ),
    );

    const sanitizedInputs = sanitizeUpdateArticleInputs(filteredDataToSanitize);

    // Récupérer les données sanitizées
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

    logger.debug('Input sanitization completed', {
      requestId,
      articleId: id,
      component: 'articles',
      action: 'input_sanitization_completed',
      operation: 'edit_article',
      fieldsCount: Object.keys(filteredDataToSanitize).length,
    });

    // ===== ÉTAPE 7: VALIDATION AVEC YUP =====
    try {
      // Filtrer les champs undefined pour la validation
      const dataToValidate = Object.fromEntries(
        Object.entries({
          title: sanitizedTitle,
          text: sanitizedText,
          imageUrl: sanitizedImageUrl,
          isActive: sanitizedIsActive,
        }).filter(([_, value]) => value !== undefined),
      );

      // Valider les données avec le schema Yup pour les mises à jour
      await updateArticleSchema.validate(dataToValidate, {
        abortEarly: false,
      });

      logger.debug('Article validation with Yup passed', {
        requestId,
        articleId: id,
        component: 'articles',
        action: 'yup_validation_success',
        operation: 'edit_article',
        validatedFields: Object.keys(dataToValidate),
      });
    } catch (validationError) {
      const errorCategory = categorizeError(validationError);

      logger.error('Article Validation Error with Yup', {
        category: errorCategory,
        failed_fields: validationError.inner?.map((err) => err.path) || [],
        total_errors: validationError.inner?.length || 0,
        requestId,
        articleId: id,
        component: 'articles',
        action: 'yup_validation_failed',
        operation: 'edit_article',
      });

      // Capturer l'erreur de validation avec Sentry
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
    // Si l'image a changé, supprimer l'ancienne image de Cloudinary
    if (oldImageId && sanitizedImageUrl && oldImageId !== sanitizedImageUrl) {
      try {
        logger.debug('Deleting old image from Cloudinary', {
          requestId,
          articleId: id,
          oldImageId,
          component: 'articles',
          action: 'cloudinary_delete_start',
          operation: 'edit_article',
        });

        await cloudinary.uploader.destroy(oldImageId);

        logger.debug('Old image deleted from Cloudinary successfully', {
          requestId,
          articleId: id,
          oldImageId,
          component: 'articles',
          action: 'cloudinary_delete_success',
          operation: 'edit_article',
        });
      } catch (cloudError) {
        logger.error('Error deleting old image from Cloudinary', {
          requestId,
          articleId: id,
          oldImageId,
          error: cloudError.message,
          component: 'articles',
          action: 'cloudinary_delete_failed',
          operation: 'edit_article',
        });

        // Capturer l'erreur Cloudinary avec Sentry (non critique)
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
        // Ne pas arrêter le processus pour une erreur Cloudinary
      }
    }

    // ===== ÉTAPE 9: MISE À JOUR EN BASE DE DONNÉES =====
    let result;
    try {
      // Construire la requête dynamiquement selon les champs fournis
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

      // Toujours mettre à jour la date de modification
      updateFields.push(`article_updated = NOW()`);

      // Ajouter l'ID de l'article à la fin
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

      logger.debug('Executing article update query', {
        requestId,
        articleId: id,
        component: 'articles',
        action: 'query_start',
        operation: 'edit_article',
        table: 'admin.articles',
        fieldsToUpdate: updateFields.length - 1, // -1 pour exclure article_updated
      });

      result = await client.query(queryText, updateValues);

      if (result.rows.length === 0) {
        logger.warn('Article not found for update', {
          requestId,
          articleId: id,
          component: 'articles',
          action: 'article_not_found',
          operation: 'edit_article',
        });

        // Capturer l'article non trouvé avec Sentry
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

      logger.debug('Article update query executed successfully', {
        requestId,
        articleId: id,
        component: 'articles',
        action: 'query_success',
        operation: 'edit_article',
        updatedFields: updateFields.length - 1,
      });
    } catch (updateError) {
      const errorCategory = categorizeError(updateError);

      logger.error('Article Update Error', {
        category: errorCategory,
        message: updateError.message,
        operation: 'UPDATE admin.articles',
        table: 'admin.articles',
        requestId,
        articleId: id,
        component: 'articles',
        action: 'query_failed',
      });

      // Capturer l'erreur de mise à jour avec Sentry
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

    // Invalider le cache des articles après modification réussie
    const cacheInvalidation = invalidateArticlesCache(requestId, id);

    // ===== ÉTAPE 11: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Article update successful', {
      articleId: id,
      articleTitle: updatedArticle.article_title,
      response_time_ms: responseTime,
      database_operations: 3, // connection + check + update
      cache_invalidated: cacheInvalidation.listInvalidated,
      success: true,
      requestId,
      component: 'articles',
      action: 'update_success',
      entity: 'blog_article',
      rateLimitingApplied: true,
      operation: 'edit_article',
      sanitizationApplied: true,
      yupValidationApplied: true,
    });

    // Capturer le succès de la mise à jour avec Sentry
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

    // Générer les headers de sécurité pour la réponse de succès
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
      reached_global_handler: true,
      error_name: error.name,
      error_message: error.message,
      stack_available: !!error.stack,
      requestId,
      articleId: id,
      component: 'articles',
      action: 'global_error_handler',
      entity: 'blog_article',
      operation: 'edit_article',
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

    // Générer les headers de sécurité même en cas d'erreur globale
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
