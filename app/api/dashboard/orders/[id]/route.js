import { NextResponse } from 'next/server';
import { getClient } from '@backend/dbConnect';
import { applyRateLimit } from '@backend/rateLimiter';
import isAuthenticatedUser from '@backend/authMiddleware';
import {
  captureException,
  captureMessage,
  captureDatabaseError,
} from '@monitoring/sentry';
import {
  categorizeError,
  generateRequestId,
  extractRealIp,
  anonymizeIp,
} from '@utils/helpers';
import logger from '@utils/logger';

// ----- CONFIGURATION DU RATE LIMITING POUR LES DÉTAILS DE COMMANDE -----

// Créer le middleware de rate limiting spécifique pour les détails de commande
const singleOrderRateLimit = applyRateLimit('orders', {
  // Configuration personnalisée pour les détails de commande (données sensibles)
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // 60 requêtes par minute (plus généreux pour consultation)
  message:
    'Trop de requêtes vers les détails de commande. Veuillez réessayer dans quelques instants.',
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
  prefix: 'single_order',

  // Fonction personnalisée pour générer la clé (basée sur IP)
  keyGenerator: (req) => {
    const ip = extractRealIp(req);
    return `single_order:ip:${ip}`;
  },
});

/**
 * GET /api/dashboard/orders/[id]
 * Récupère les détails d'une commande spécifique avec toutes ses relations
 * Production-ready avec authentification, rate limiting et monitoring complet
 */
export async function GET(req, { params }) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();
  const orderId = params?.id;

  logger.info('Single Order API called', {
    timestamp: new Date().toISOString(),
    requestId,
    component: 'single_order',
    action: 'api_start',
    method: 'GET',
    orderId: orderId || 'missing',
  });

  // Capturer le début du processus de récupération de la commande
  captureMessage('Single order fetch process started', {
    level: 'info',
    tags: {
      component: 'single_order',
      action: 'process_start',
      api_endpoint: '/api/dashboard/orders/[id]',
      entity: 'order',
      data_type: 'financial',
    },
    extra: {
      requestId,
      timestamp: new Date().toISOString(),
      method: 'GET',
      orderId: orderId || 'missing',
    },
  });

  try {
    // ===== ÉTAPE 1: VALIDATION DU PARAMÈTRE ID =====
    logger.debug('Validating order ID parameter', {
      requestId,
      component: 'single_order',
      action: 'id_validation_start',
      orderId: orderId || 'missing',
    });

    if (!orderId) {
      logger.warn('Order ID parameter missing', {
        requestId,
        component: 'single_order',
        action: 'id_validation_failed',
        reason: 'missing_parameter',
      });

      return NextResponse.json(
        {
          success: false,
          error: 'Missing order ID',
          message: "L'ID de la commande est requis",
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

    // Validation du format UUID
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(orderId)) {
      logger.warn('Order ID format invalid', {
        requestId,
        component: 'single_order',
        action: 'id_validation_failed',
        reason: 'invalid_uuid_format',
        orderId: orderId.substring(0, 10), // Tronquer pour les logs
      });

      return NextResponse.json(
        {
          success: false,
          error: 'Invalid order ID format',
          message: "Le format de l'ID de commande est invalide",
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

    logger.debug('Order ID validation successful', {
      requestId,
      component: 'single_order',
      action: 'id_validation_success',
    });

    // ===== ÉTAPE 2: APPLIQUER LE RATE LIMITING =====
    logger.debug('Applying rate limiting for single order API', {
      requestId,
      component: 'single_order',
      action: 'rate_limit_start',
      data_sensitivity: 'high',
    });

    const rateLimitResponse = await singleOrderRateLimit(req);

    if (rateLimitResponse) {
      logger.warn('Single Order API rate limit exceeded', {
        requestId,
        component: 'single_order',
        action: 'rate_limit_exceeded',
        ip: anonymizeIp(extractRealIp(req)),
        data_type: 'financial',
      });

      // Capturer l'événement de rate limiting avec Sentry
      captureMessage('Single Order API rate limit exceeded', {
        level: 'warning',
        tags: {
          component: 'single_order',
          action: 'rate_limit_exceeded',
          error_category: 'rate_limiting',
          entity: 'order',
          data_type: 'financial',
        },
        extra: {
          requestId,
          ip: anonymizeIp(extractRealIp(req)),
          userAgent:
            req.headers.get('user-agent')?.substring(0, 100) || 'unknown',
        },
      });

      return rateLimitResponse;
    }

    logger.debug('Rate limiting passed successfully', {
      requestId,
      component: 'single_order',
      action: 'rate_limit_passed',
    });

    // ===== ÉTAPE 3: VÉRIFICATION AUTHENTIFICATION =====
    logger.debug('Verifying user authentication', {
      requestId,
      component: 'single_order',
      action: 'auth_verification_start',
    });

    await isAuthenticatedUser(req, NextResponse);

    logger.debug('User authentication verified successfully', {
      requestId,
      component: 'single_order',
      action: 'auth_verification_success',
    });

    // ===== ÉTAPE 4: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
      logger.debug('Database connection successful', {
        requestId,
        component: 'single_order',
        action: 'db_connection_success',
      });
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Database Connection Error during single order fetch', {
        category: errorCategory,
        message: dbConnectionError.message,
        timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
        requestId,
        component: 'single_order',
        action: 'db_connection_failed',
        entity: 'order',
      });

      // Capturer l'erreur de connexion DB avec Sentry
      captureDatabaseError(dbConnectionError, {
        tags: {
          component: 'single_order',
          action: 'db_connection_failed',
          operation: 'connection',
          entity: 'order',
          data_type: 'financial',
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
          error: 'Service temporarily unavailable',
          message: 'Impossible de se connecter à la base de données',
          requestId,
        },
        {
          status: 503,
          headers: {
            'X-Request-ID': requestId,
            'Retry-After': '60',
          },
        },
      );
    }

    // ===== ÉTAPE 5: EXÉCUTION DE LA REQUÊTE =====
    let orderResult;
    try {
      // Requête complexe avec toutes les relations
      const orderQuery = `
        SELECT 
          -- Données de la commande
          o.order_id,
          o.order_client,
          o.order_platform_id,
          o.order_application_id,
          o.order_payment_name,
          o.order_payment_number,
          o.order_price,
          o.order_payment_status,
          o.order_cancel_reason,
          o.order_cancelled_at,
          o.order_paid_at,
          o.order_created,
          o.order_updated,
          
          -- Données de l'application
          a.application_name,
          a.application_category,
          a.application_images,
          a.application_description,
          a.application_fee,
          a.application_rent,
          a.application_link,
          a.application_level,
          
          -- Données de la plateforme de paiement
          p.platform_name,
          p.platform_type,
          p.platform_description,
          p.platform_fee_percentage,
          p.platform_currency,
          p.platform_status
          
        FROM admin.orders o
        JOIN catalog.applications a ON o.order_application_id = a.application_id
        JOIN admin.platforms p ON o.order_platform_id = p.platform_id
        WHERE o.order_id = $1
      `;

      logger.debug('Executing single order query', {
        requestId,
        component: 'single_order',
        action: 'query_start',
        table: 'admin.orders',
        operation: 'SELECT_WITH_JOINS',
        orderId: orderId.substring(0, 8), // Tronquer pour les logs
      });

      orderResult = await client.query(orderQuery, [orderId]);

      logger.debug('Single order query executed successfully', {
        requestId,
        component: 'single_order',
        action: 'query_success',
        found: orderResult.rows.length > 0,
        table: 'admin.orders',
      });
    } catch (queryError) {
      const errorCategory = categorizeError(queryError);

      logger.error('Single Order Query Error', {
        category: errorCategory,
        message: queryError.message,
        query: 'single_order_fetch_with_relations',
        table: 'admin.orders',
        requestId,
        component: 'single_order',
        action: 'query_failed',
        entity: 'order',
      });

      // Capturer l'erreur de requête avec Sentry
      captureDatabaseError(queryError, {
        tags: {
          component: 'single_order',
          action: 'query_failed',
          operation: 'SELECT_WITH_JOINS',
          entity: 'order',
          data_type: 'financial',
        },
        extra: {
          requestId,
          table: 'admin.orders',
          queryType: 'single_order_fetch_with_relations',
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
          error: 'Database query failed',
          message: 'Impossible de récupérer la commande',
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

    // ===== ÉTAPE 6: VÉRIFICATION DE L'EXISTENCE =====
    if (orderResult.rows.length === 0) {
      logger.warn('Order not found', {
        requestId,
        component: 'single_order',
        action: 'order_not_found',
        orderId: orderId.substring(0, 8),
      });

      captureMessage('Order not found', {
        level: 'warning',
        tags: {
          component: 'single_order',
          action: 'order_not_found',
          entity: 'order',
        },
        extra: {
          requestId,
          orderId: orderId.substring(0, 8),
          ip: anonymizeIp(extractRealIp(req)),
        },
      });

      if (client) await client.cleanup();
      return NextResponse.json(
        {
          success: false,
          error: 'Order not found',
          message: "La commande demandée n'existe pas",
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

    // ===== ÉTAPE 7: FORMATAGE ET SANITISATION DES DONNÉES =====
    const orderData = orderResult.rows[0];

    // Parser et valider les données client
    let clientInfo = null;
    try {
      if (orderData.order_client && Array.isArray(orderData.order_client)) {
        const [lastName, firstName, email, phone] = orderData.order_client;
        clientInfo = {
          lastName: lastName || '',
          firstName: firstName || '',
          email: email || '',
          phone: phone || '',
          fullName: `${firstName || ''} ${lastName || ''}`.trim() || 'N/A',
        };
      }
    } catch (clientParseError) {
      logger.warn('Failed to parse client data', {
        requestId,
        component: 'single_order',
        action: 'client_parse_error',
        error: clientParseError.message,
      });

      clientInfo = {
        lastName: 'N/A',
        firstName: 'N/A',
        email: 'N/A',
        phone: 'N/A',
        fullName: 'N/A',
      };
    }

    // Sanitiser les données sensibles
    const sanitizedOrder = {
      // Informations de base de la commande
      order_id: orderData.order_id,
      order_price: parseFloat(orderData.order_price) || 0,
      order_payment_status: orderData.order_payment_status,
      order_cancel_reason: orderData.order_cancel_reason || null,
      order_cancelled_at: orderData.order_cancelled_at,
      order_paid_at: orderData.order_paid_at,
      order_created: orderData.order_created,
      order_updated: orderData.order_updated,

      // Informations client (partiellement anonymisées pour les logs)
      client: clientInfo,

      // Informations de paiement (masquées pour la sécurité)
      payment: {
        name: orderData.order_payment_name,
        // Masquer partiellement le numéro de paiement
        number: orderData.order_payment_number
          ? `****${orderData.order_payment_number.slice(-4)}`
          : 'N/A',
        platform_id: orderData.order_platform_id,
      },

      // Informations de l'application
      application: {
        id: orderData.order_application_id,
        name: orderData.application_name || '[No Name]',
        category: orderData.application_category,
        images: orderData.application_images,
        description: orderData.application_description,
        fee: parseFloat(orderData.application_fee) || 0,
        rent: parseFloat(orderData.application_rent) || 0,
        link: orderData.application_link,
        level: orderData.application_level,
      },

      // Informations de la plateforme de paiement
      platform: {
        id: orderData.order_platform_id,
        name: orderData.platform_name || '[No Name]',
        type: orderData.platform_type,
        description: orderData.platform_description,
        fee_percentage: parseFloat(orderData.platform_fee_percentage) || 0,
        currency: orderData.platform_currency || 'EUR',
        status: orderData.platform_status,
      },
    };

    logger.debug('Order data sanitized successfully', {
      requestId,
      component: 'single_order',
      action: 'data_sanitization',
      orderId: orderData.order_id.substring(0, 8),
      hasClientData: !!clientInfo,
      paymentStatus: orderData.order_payment_status,
    });

    // ===== ÉTAPE 8: FORMATAGE DE LA RÉPONSE =====
    const response = {
      success: true,
      data: {
        order: sanitizedOrder,
      },
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
        orderId: orderData.order_id,
      },
    };

    // ===== ÉTAPE 9: SUCCÈS - LOG ET NETTOYAGE =====
    const responseTime = Date.now() - startTime;

    logger.info('Single order fetch successful', {
      orderId: orderData.order_id.substring(0, 8),
      paymentStatus: orderData.order_payment_status,
      orderPrice: parseFloat(orderData.order_price) || 0,
      response_time_ms: responseTime,
      database_operations: 2, // connection + query
      success: true,
      requestId,
      component: 'single_order',
      action: 'fetch_success',
      entity: 'order',
      data_type: 'financial',
      rateLimitingApplied: true,
    });

    // Capturer le succès de la récupération avec Sentry
    captureMessage('Single order fetch completed successfully', {
      level: 'info',
      tags: {
        component: 'single_order',
        action: 'fetch_success',
        success: 'true',
        entity: 'order',
        data_type: 'financial',
      },
      extra: {
        requestId,
        orderId: orderData.order_id.substring(0, 8),
        paymentStatus: orderData.order_payment_status,
        responseTimeMs: responseTime,
        databaseOperations: 2,
        ip: anonymizeIp(extractRealIp(req)),
        rateLimitingApplied: true,
      },
    });

    if (client) await client.cleanup();

    return NextResponse.json(response, {
      status: 200,
      headers: {
        'X-Request-ID': requestId,
        'X-Response-Time': `${responseTime}ms`,
        'X-Order-ID': orderData.order_id,
        'X-Order-Status': orderData.order_payment_status,
        // Pas de cache pour les données sensibles
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        Pragma: 'no-cache',
        Expires: '0',
      },
    });
  } catch (error) {
    // ===== GESTION GLOBALE DES ERREURS =====
    const errorCategory = categorizeError(error);
    const responseTime = Date.now() - startTime;

    logger.error('Global Single Order Error', {
      category: errorCategory,
      response_time_ms: responseTime,
      reached_global_handler: true,
      error_name: error.name,
      error_message: error.message,
      stack_available: !!error.stack,
      requestId,
      component: 'single_order',
      action: 'global_error_handler',
      entity: 'order',
      data_type: 'financial',
      orderId: orderId ? orderId.substring(0, 8) : 'unknown',
    });

    // Capturer l'erreur globale avec Sentry
    captureException(error, {
      level: 'error',
      tags: {
        component: 'single_order',
        action: 'global_error_handler',
        error_category: errorCategory,
        critical: 'true',
        entity: 'order',
        data_type: 'financial',
      },
      extra: {
        requestId,
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        process: 'single_order_fetch',
        ip: anonymizeIp(extractRealIp(req)),
        rateLimitingApplied: true,
        orderId: orderId ? orderId.substring(0, 8) : 'unknown',
      },
    });

    // Nettoyer les ressources en cas d'erreur
    if (client) {
      try {
        await client.cleanup();
      } catch (cleanupError) {
        // Log silencieux du cleanup error
      }
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message:
          'Une erreur interne est survenue lors de la récupération de la commande',
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
