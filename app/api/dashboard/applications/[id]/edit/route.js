/* eslint-disable no-unused-vars */
// app/api/dashboard/applications/[id]/edit/route.js
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
import {
  applicationUpdateSchema,
  applicationIdSchema,
  cleanUUID,
} from '@/utils/schemas/applicationSchema';
// AJOUT POUR L'INVALIDATION DU CACHE
import { dashboardCache, getDashboardCacheKey } from '@/utils/cache';
import { sanitizeApplicationUpdateInputsStrict } from '@utils/sanitizers/sanitizeApplicationUpdateInputs';

// ----- CONFIGURATION DU RATE LIMITING POUR LA MODIFICATION D'APPLICATIONS -----

// Créer le middleware de rate limiting spécifique pour la modification d'applications
const editApplicationRateLimit = applyRateLimit('CONTENT_API', {
  // Configuration personnalisée pour la modification d'applications
  windowMs: 2 * 60 * 1000, // 2 minutes
  max: 15, // 15 modifications par 2 minutes (plus restrictif que templates car plus sensible)
  message:
    "Trop de tentatives de modification d'applications. Veuillez réessayer dans quelques minutes.",
  skipSuccessfulRequests: false, // Compter toutes les modifications réussies
  skipFailedRequests: false, // Compter aussi les échecs
  prefix: 'edit_application', // Préfixe spécifique pour la modification d'applications

  // Fonction personnalisée pour générer la clé (basée sur IP + ID de l'application)
  keyGenerator: (req) => {
    const ip = extractRealIp(req);
    const url = req.url || req.nextUrl?.pathname || '';
    const applicationIdMatch = url.match(/applications\/([^/]+)\/edit/);
    const applicationId = applicationIdMatch
      ? applicationIdMatch[1]
      : 'unknown';
    return `edit_application:ip:${ip}:application:${applicationId}`;
  },
});

// ----- FONCTION D'INVALIDATION DU CACHE -----
const invalidateApplicationsCache = (requestId, applicationId) => {
  try {
    const cacheKey = getDashboardCacheKey('applications_list', {
      endpoint: 'dashboard_applications',
      version: '1.0',
    });

    const cacheInvalidated = dashboardCache.applications.delete(cacheKey);

    logger.debug('Applications cache invalidation', {
      requestId,
      applicationId,
      component: 'applications',
      action: 'cache_invalidation',
      operation: 'edit_application',
      cacheKey,
      invalidated: cacheInvalidated,
    });

    // Capturer l'invalidation du cache avec Sentry
    captureMessage('Applications cache invalidated after modification', {
      level: 'info',
      tags: {
        component: 'applications',
        action: 'cache_invalidation',
        entity: 'application',
        operation: 'update',
      },
      extra: {
        requestId,
        applicationId,
        cacheKey,
        invalidated: cacheInvalidated,
      },
    });

    return cacheInvalidated;
  } catch (cacheError) {
    logger.warn('Failed to invalidate applications cache', {
      requestId,
      applicationId,
      component: 'applications',
      action: 'cache_invalidation_failed',
      operation: 'edit_application',
      error: cacheError.message,
    });

    captureException(cacheError, {
      level: 'warning',
      tags: {
        component: 'applications',
        action: 'cache_invalidation_failed',
        error_category: 'cache',
        entity: 'application',
        operation: 'update',
      },
      extra: {
        requestId,
        applicationId,
      },
    });

    return false;
  }
};

// ----- API ROUTE PRINCIPALE AVEC RATE LIMITING ET MONITORING SENTRY -----

export async function PUT(request, { params }) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();
  const { id } = params;

  logger.info('Edit Application API called', {
    timestamp: new Date().toISOString(),
    requestId,
    applicationId: id,
    component: 'applications',
    action: 'api_start',
    method: 'PUT',
    operation: 'edit_application',
  });

  // Capturer le début du processus de modification d'application
  captureMessage('Edit application process started', {
    level: 'info',
    tags: {
      component: 'applications',
      action: 'process_start',
      api_endpoint: '/api/dashboard/applications/[id]/edit',
      entity: 'application',
      operation: 'update',
    },
    extra: {
      requestId,
      applicationId: id,
      timestamp: new Date().toISOString(),
      method: 'PUT',
    },
  });

  try {
    // ===== ÉTAPE 1: VALIDATION DE L'ID DE L'APPLICATION =====
    logger.debug('Validating application ID', {
      requestId,
      applicationId: id,
      component: 'applications',
      action: 'id_validation_start',
      operation: 'edit_application',
    });

    try {
      await applicationIdSchema.validate({ id }, { abortEarly: false });

      logger.debug('Application ID validation passed', {
        requestId,
        applicationId: id,
        component: 'applications',
        action: 'id_validation_success',
        operation: 'edit_application',
      });
    } catch (idValidationError) {
      const errorCategory = categorizeError(idValidationError);

      logger.error('Application ID Validation Error', {
        category: errorCategory,
        applicationId: id,
        validation_errors: idValidationError.inner?.map(
          (err) => err.message,
        ) || [idValidationError.message],
        requestId,
        component: 'applications',
        action: 'id_validation_failed',
        operation: 'edit_application',
      });

      // Capturer l'erreur de validation d'ID avec Sentry
      captureMessage('Application ID validation failed', {
        level: 'warning',
        tags: {
          component: 'applications',
          action: 'id_validation_failed',
          error_category: 'validation',
          entity: 'application',
          operation: 'update',
        },
        extra: {
          requestId,
          applicationId: id,
          validationErrors: idValidationError.inner?.map(
            (err) => err.message,
          ) || [idValidationError.message],
          ip: anonymizeIp(extractRealIp(request)),
        },
      });

      return NextResponse.json(
        {
          error: 'Invalid application ID format',
          details: idValidationError.inner?.map((err) => err.message) || [
            idValidationError.message,
          ],
        },
        { status: 400 },
      );
    }

    // Nettoyer l'UUID pour garantir le format correct
    const cleanedApplicationId = cleanUUID(id);
    if (!cleanedApplicationId) {
      logger.warn('Application ID cleaning failed', {
        requestId,
        component: 'applications',
        action: 'id_cleaning_failed',
        operation: 'edit_application',
        providedId: id,
      });

      return NextResponse.json(
        { error: 'Invalid application ID format' },
        { status: 400 },
      );
    }

    // ===== ÉTAPE 2: APPLIQUER LE RATE LIMITING =====
    logger.debug('Applying rate limiting for edit application API', {
      requestId,
      applicationId: cleanedApplicationId,
      component: 'applications',
      action: 'rate_limit_start',
      operation: 'edit_application',
    });

    const rateLimitResponse = await editApplicationRateLimit(request);

    if (rateLimitResponse) {
      logger.warn('Edit application API rate limit exceeded', {
        requestId,
        applicationId: cleanedApplicationId,
        component: 'applications',
        action: 'rate_limit_exceeded',
        operation: 'edit_application',
        ip: anonymizeIp(extractRealIp(request)),
      });

      // Capturer l'événement de rate limiting avec Sentry
      captureMessage('Edit application API rate limit exceeded', {
        level: 'warning',
        tags: {
          component: 'applications',
          action: 'rate_limit_exceeded',
          error_category: 'rate_limiting',
          entity: 'application',
          operation: 'update',
        },
        extra: {
          requestId,
          applicationId: cleanedApplicationId,
          ip: anonymizeIp(extractRealIp(request)),
          userAgent:
            request.headers.get('user-agent')?.substring(0, 100) || 'unknown',
        },
      });

      return rateLimitResponse;
    }

    logger.debug('Rate limiting passed successfully', {
      requestId,
      applicationId: cleanedApplicationId,
      component: 'applications',
      action: 'rate_limit_passed',
      operation: 'edit_application',
    });

    // ===== ÉTAPE 3: VÉRIFICATION AUTHENTIFICATION =====
    logger.debug('Verifying user authentication', {
      requestId,
      applicationId: cleanedApplicationId,
      component: 'applications',
      action: 'auth_verification_start',
      operation: 'edit_application',
    });

    await isAuthenticatedUser(request, NextResponse);

    logger.debug('User authentication verified successfully', {
      requestId,
      applicationId: cleanedApplicationId,
      component: 'applications',
      action: 'auth_verification_success',
      operation: 'edit_application',
    });

    // ===== ÉTAPE 4: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
      logger.debug('Database connection successful', {
        requestId,
        applicationId: cleanedApplicationId,
        component: 'applications',
        action: 'db_connection_success',
        operation: 'edit_application',
      });
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Database Connection Error during application edit', {
        category: errorCategory,
        message: dbConnectionError.message,
        timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
        requestId,
        applicationId: cleanedApplicationId,
        component: 'applications',
        action: 'db_connection_failed',
        operation: 'edit_application',
      });

      // Capturer l'erreur de connexion DB avec Sentry
      captureDatabaseError(dbConnectionError, {
        tags: {
          component: 'applications',
          action: 'db_connection_failed',
          operation: 'connection',
          entity: 'application',
        },
        extra: {
          requestId,
          applicationId: cleanedApplicationId,
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

    // ===== ÉTAPE 5: PARSING ET VALIDATION DU BODY =====
    let body;
    try {
      body = await request.json();
      logger.debug('Request body parsed successfully', {
        requestId,
        applicationId: cleanedApplicationId,
        component: 'applications',
        action: 'body_parse_success',
        operation: 'edit_application',
      });
    } catch (parseError) {
      const errorCategory = categorizeError(parseError);

      logger.error('JSON Parse Error during application edit', {
        category: errorCategory,
        message: parseError.message,
        requestId,
        applicationId: cleanedApplicationId,
        component: 'applications',
        action: 'json_parse_error',
        operation: 'edit_application',
        headers: {
          'content-type': request.headers.get('content-type'),
          'user-agent': request.headers.get('user-agent')?.substring(0, 100),
        },
      });

      captureException(parseError, {
        level: 'error',
        tags: {
          component: 'applications',
          action: 'json_parse_error',
          error_category: categorizeError(parseError),
          operation: 'update',
        },
        extra: {
          requestId,
          applicationId: cleanedApplicationId,
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

    const {
      name,
      link,
      admin,
      description,
      category,
      level,
      fee,
      rent,
      imageUrls,
      otherVersions,
      isActive,
      oldImageUrls, // Pour supprimer les anciennes images
    } = body;

    logger.debug('Application data extracted from request', {
      requestId,
      applicationId: cleanedApplicationId,
      component: 'applications',
      action: 'data_extraction',
      operation: 'edit_application',
      hasName: !!name,
      hasLink: !!link,
      hasAdmin: !!admin,
      hasCategory: !!category,
      hasLevel: level !== undefined,
      hasIsActive: isActive !== undefined,
      imageCount: Array.isArray(imageUrls) ? imageUrls.length : 0,
    });

    // ===== ÉTAPE 6: SANITIZATION DES INPUTS (SAUF isActive et level) =====
    logger.debug('Sanitizing application inputs', {
      requestId,
      applicationId: cleanedApplicationId,
      component: 'applications',
      action: 'input_sanitization',
      operation: 'edit_application',
    });

    // Préparer les données pour la sanitization (exclure isActive et level)
    const dataToSanitize = {
      name,
      link,
      admin,
      description,
      category,
      fee,
      rent,
      imageUrls,
      otherVersions,
    };

    // Filtrer les valeurs undefined pour la sanitization
    const filteredDataToSanitize = Object.fromEntries(
      Object.entries(dataToSanitize).filter(
        ([_, value]) => value !== undefined,
      ),
    );

    const sanitizedInputs = sanitizeApplicationUpdateInputsStrict(
      filteredDataToSanitize,
    );

    // Récupérer les données sanitizées et ajouter les champs non sanitizés
    const {
      name: sanitizedName,
      link: sanitizedLink,
      admin: sanitizedAdmin,
      description: sanitizedDescription,
      category: sanitizedCategory,
      fee: sanitizedFee,
      rent: sanitizedRent,
      imageUrls: sanitizedImageUrls,
      otherVersions: sanitizedOtherVersions,
    } = sanitizedInputs;

    // isActive et level ne sont pas sanitizés selon vos instructions
    const finalData = {
      name: sanitizedName,
      link: sanitizedLink,
      admin: sanitizedAdmin,
      description: sanitizedDescription,
      category: sanitizedCategory,
      level, // Non sanitizé
      fee: sanitizedFee,
      rent: sanitizedRent,
      imageUrls: sanitizedImageUrls,
      otherVersions: sanitizedOtherVersions,
      isActive, // Non sanitizé
      oldImageUrls, // Non sanitizé car utilisé pour la logique interne
    };

    logger.debug('Input sanitization completed', {
      requestId,
      applicationId: cleanedApplicationId,
      component: 'applications',
      action: 'input_sanitization_completed',
      operation: 'edit_application',
    });

    // ===== ÉTAPE 7: VALIDATION AVEC YUP =====
    try {
      // Filtrer les champs undefined pour la validation
      const dataToValidate = Object.fromEntries(
        Object.entries({
          name: finalData.name,
          link: finalData.link,
          admin: finalData.admin,
          description: finalData.description,
          category: finalData.category,
          level: finalData.level,
          fee: finalData.fee,
          rent: finalData.rent,
          imageUrls: finalData.imageUrls,
          otherVersions: finalData.otherVersions,
          isActive: finalData.isActive,
        }).filter(([_, value]) => value !== undefined),
      );

      // Valider les données avec le schema Yup pour les mises à jour
      await applicationUpdateSchema.validate(dataToValidate, {
        abortEarly: false,
      });

      logger.debug('Application validation with Yup passed', {
        requestId,
        applicationId: cleanedApplicationId,
        component: 'applications',
        action: 'yup_validation_success',
        operation: 'edit_application',
      });
    } catch (validationError) {
      const errorCategory = categorizeError(validationError);

      logger.error('Application Validation Error with Yup', {
        category: errorCategory,
        failed_fields: validationError.inner?.map((err) => err.path) || [],
        total_errors: validationError.inner?.length || 0,
        requestId,
        applicationId: cleanedApplicationId,
        component: 'applications',
        action: 'yup_validation_failed',
        operation: 'edit_application',
      });

      // Capturer l'erreur de validation avec Sentry
      captureMessage('Application validation failed with Yup schema', {
        level: 'warning',
        tags: {
          component: 'applications',
          action: 'yup_validation_failed',
          error_category: 'validation',
          entity: 'application',
          operation: 'update',
        },
        extra: {
          requestId,
          applicationId: cleanedApplicationId,
          failedFields: validationError.inner?.map((err) => err.path) || [],
          totalErrors: validationError.inner?.length || 0,
          validationErrors:
            validationError.inner?.map((err) => ({
              field: err.path,
              message: err.message,
            })) || [],
          ip: anonymizeIp(extractRealIp(request)),
        },
      });

      if (client) await client.cleanup();

      const errors = {};
      validationError.inner.forEach((error) => {
        errors[error.path] = error.message;
      });

      return NextResponse.json({ errors }, { status: 400 });
    }

    // ===== ÉTAPE 8: GESTION DES IMAGES CLOUDINARY =====
    // Si des images ont été supprimées, les supprimer de Cloudinary
    if (
      oldImageUrls &&
      Array.isArray(oldImageUrls) &&
      oldImageUrls.length > 0
    ) {
      const currentImages = sanitizedImageUrls || [];
      const imagesToDelete = oldImageUrls.filter(
        (oldImg) => !currentImages.includes(oldImg),
      );

      if (imagesToDelete.length > 0) {
        logger.debug('Deleting old images from Cloudinary', {
          requestId,
          applicationId: cleanedApplicationId,
          imagesToDelete: imagesToDelete.length,
          component: 'applications',
          action: 'cloudinary_delete_start',
          operation: 'edit_application',
        });

        // Supprimer les images en parallèle
        const deletePromises = imagesToDelete.map(async (imageId) => {
          try {
            await cloudinary.uploader.destroy(imageId);
            logger.debug('Image deleted from Cloudinary', {
              requestId,
              applicationId: cleanedApplicationId,
              imageId,
              component: 'applications',
              action: 'cloudinary_delete_success',
              operation: 'edit_application',
            });
          } catch (deleteError) {
            logger.error('Error deleting image from Cloudinary', {
              requestId,
              applicationId: cleanedApplicationId,
              imageId,
              error: deleteError.message,
              component: 'applications',
              action: 'cloudinary_delete_failed',
              operation: 'edit_application',
            });

            // Capturer l'erreur Cloudinary avec Sentry (non critique)
            captureException(deleteError, {
              level: 'warning',
              tags: {
                component: 'applications',
                action: 'cloudinary_delete_failed',
                error_category: 'media_upload',
                entity: 'application',
                operation: 'update',
              },
              extra: {
                requestId,
                applicationId: cleanedApplicationId,
                imageId,
              },
            });
          }
        });

        // Attendre toutes les suppressions (non bloquant en cas d'erreur)
        await Promise.allSettled(deletePromises);
      }
    }

    // ===== ÉTAPE 9: MISE À JOUR EN BASE DE DONNÉES =====
    let result;
    try {
      // Construire la requête dynamiquement selon les champs fournis
      const updateFields = [];
      const updateValues = [];
      let paramCounter = 1;

      if (sanitizedName !== undefined) {
        updateFields.push(`application_name = $${paramCounter}`);
        updateValues.push(sanitizedName);
        paramCounter++;
      }

      if (sanitizedLink !== undefined) {
        updateFields.push(`application_link = $${paramCounter}`);
        updateValues.push(sanitizedLink);
        paramCounter++;
      }

      if (sanitizedAdmin !== undefined) {
        updateFields.push(`application_admin_link = $${paramCounter}`);
        updateValues.push(sanitizedAdmin);
        paramCounter++;
      }

      if (sanitizedDescription !== undefined) {
        updateFields.push(`application_description = $${paramCounter}`);
        updateValues.push(sanitizedDescription);
        paramCounter++;
      }

      if (sanitizedCategory !== undefined) {
        updateFields.push(`application_category = $${paramCounter}`);
        updateValues.push(sanitizedCategory);
        paramCounter++;
      }

      if (level !== undefined) {
        updateFields.push(`application_level = $${paramCounter}`);
        updateValues.push(level);
        paramCounter++;
      }

      if (sanitizedFee !== undefined) {
        updateFields.push(`application_fee = $${paramCounter}`);
        updateValues.push(sanitizedFee);
        paramCounter++;
      }

      if (sanitizedRent !== undefined) {
        updateFields.push(`application_rent = $${paramCounter}`);
        updateValues.push(sanitizedRent);
        paramCounter++;
      }

      if (sanitizedImageUrls !== undefined) {
        updateFields.push(`application_images = $${paramCounter}`);
        updateValues.push(sanitizedImageUrls);
        paramCounter++;
      }

      if (sanitizedOtherVersions !== undefined) {
        updateFields.push(`application_other_versions = $${paramCounter}`);
        updateValues.push(sanitizedOtherVersions);
        paramCounter++;
      }

      if (isActive !== undefined) {
        updateFields.push(`is_active = $${paramCounter}`);
        updateValues.push(isActive);
        paramCounter++;
      }

      // Toujours mettre à jour updated_at
      updateFields.push(`updated_at = $${paramCounter}`);
      updateValues.push(new Date().toISOString());
      paramCounter++;

      // Ajouter l'ID de l'application à la fin
      updateValues.push(cleanedApplicationId);

      const queryText = `
        UPDATE catalog.applications 
        SET ${updateFields.join(', ')}
        WHERE application_id = $${paramCounter}
        RETURNING *
      `;

      logger.debug('Executing application update query', {
        requestId,
        applicationId: cleanedApplicationId,
        component: 'applications',
        action: 'query_start',
        operation: 'edit_application',
        table: 'catalog.applications',
        fieldsToUpdate: updateFields.length,
      });

      result = await client.query(queryText, updateValues);

      if (result.rows.length === 0) {
        logger.warn('Application not found for update', {
          requestId,
          applicationId: cleanedApplicationId,
          component: 'applications',
          action: 'application_not_found',
          operation: 'edit_application',
        });

        // Capturer l'application non trouvée avec Sentry
        captureMessage('Application not found for update', {
          level: 'warning',
          tags: {
            component: 'applications',
            action: 'application_not_found',
            error_category: 'not_found',
            entity: 'application',
            operation: 'update',
          },
          extra: {
            requestId,
            applicationId: cleanedApplicationId,
            ip: anonymizeIp(extractRealIp(request)),
          },
        });

        if (client) await client.cleanup();
        return NextResponse.json(
          { message: 'Application not found' },
          { status: 404 },
        );
      }

      logger.debug('Application update query executed successfully', {
        requestId,
        applicationId: cleanedApplicationId,
        component: 'applications',
        action: 'query_success',
        operation: 'edit_application',
        updatedFields: updateFields.length,
      });
    } catch (updateError) {
      const errorCategory = categorizeError(updateError);

      logger.error('Application Update Error', {
        category: errorCategory,
        message: updateError.message,
        operation: 'UPDATE catalog.applications',
        table: 'catalog.applications',
        requestId,
        applicationId: cleanedApplicationId,
        component: 'applications',
        action: 'query_failed',
      });

      // Capturer l'erreur de mise à jour avec Sentry
      captureDatabaseError(updateError, {
        tags: {
          component: 'applications',
          action: 'update_failed',
          operation: 'UPDATE',
          entity: 'application',
        },
        extra: {
          requestId,
          applicationId: cleanedApplicationId,
          table: 'catalog.applications',
          queryType: 'application_update',
          postgresCode: updateError.code,
          postgresDetail: updateError.detail ? '[Filtered]' : undefined,
          ip: anonymizeIp(extractRealIp(request)),
          rateLimitingApplied: true,
        },
      });

      if (client) await client.cleanup();
      return NextResponse.json(
        { error: 'Failed to update application', message: updateError.message },
        { status: 500 },
      );
    }

    // ===== ÉTAPE 10: INVALIDATION DU CACHE APRÈS SUCCÈS =====
    const updatedApplication = result.rows[0];

    // Invalider le cache des applications après modification réussie
    invalidateApplicationsCache(requestId, cleanedApplicationId);

    // ===== ÉTAPE 11: FORMATAGE DES DONNÉES DE RÉPONSE =====
    const sanitizedApplication = {
      application_id: updatedApplication.application_id,
      application_name: updatedApplication.application_name || '[No Name]',
      application_link: updatedApplication.application_link,
      application_admin_link: updatedApplication.application_admin_link,
      application_description: updatedApplication.application_description || '',
      application_category:
        updatedApplication.application_category || 'General',
      application_level: parseInt(updatedApplication.application_level) || 1,
      application_fee: parseFloat(updatedApplication.application_fee) || 0.0,
      application_rent: parseFloat(updatedApplication.application_rent) || 0.0,
      application_images: updatedApplication.application_images || [],
      application_other_versions:
        updatedApplication.application_other_versions || null,
      is_active: Boolean(updatedApplication.is_active),
      sales_count: parseInt(updatedApplication.sales_count) || 0,
      created_at: updatedApplication.created_at,
      updated_at: updatedApplication.updated_at,
    };

    // ===== ÉTAPE 12: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Application update successful', {
      applicationId: cleanedApplicationId,
      applicationName: sanitizedApplication.application_name,
      response_time_ms: responseTime,
      database_operations: 2, // connection + update
      cache_invalidated: true,
      success: true,
      requestId,
      component: 'applications',
      action: 'update_success',
      entity: 'application',
      rateLimitingApplied: true,
      operation: 'edit_application',
      sanitizationApplied: true,
      yupValidationApplied: true,
    });

    // Capturer le succès de la mise à jour avec Sentry
    captureMessage('Application update completed successfully', {
      level: 'info',
      tags: {
        component: 'applications',
        action: 'update_success',
        success: 'true',
        entity: 'application',
        operation: 'update',
      },
      extra: {
        requestId,
        applicationId: cleanedApplicationId,
        applicationName: sanitizedApplication.application_name,
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

    return NextResponse.json(
      {
        success: true,
        message: 'Application updated successfully',
        application: sanitizedApplication,
        meta: {
          requestId,
          timestamp: new Date().toISOString(),
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

    logger.error('Global Edit Application Error', {
      category: errorCategory,
      response_time_ms: responseTime,
      reached_global_handler: true,
      error_name: error.name,
      error_message: error.message,
      stack_available: !!error.stack,
      requestId,
      applicationId: id,
      component: 'applications',
      action: 'global_error_handler',
      entity: 'application',
      operation: 'edit_application',
    });

    // Capturer l'erreur globale avec Sentry
    captureException(error, {
      level: 'error',
      tags: {
        component: 'applications',
        action: 'global_error_handler',
        error_category: errorCategory,
        critical: 'true',
        entity: 'application',
        operation: 'update',
      },
      extra: {
        requestId,
        applicationId: id,
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'application_update',
        ip: anonymizeIp(extractRealIp(request)),
        rateLimitingApplied: true,
      },
    });

    if (client) await client.cleanup();

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: 'Failed to update application',
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
