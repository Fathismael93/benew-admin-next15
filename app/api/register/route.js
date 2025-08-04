/* eslint-disable no-unused-vars */
// api/register/route.js
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getClient } from '@backend/dbConnect';
import { registrationSchema } from '@utils/schemas/authSchema';
import { applyRateLimit } from '@backend/rateLimiter';
import {
  captureException,
  captureMessage,
  captureDatabaseError,
  captureValidationError,
} from '@/monitoring/sentry';
import {
  categorizeError,
  anonymizeUserData,
  generateRequestId,
  extractRealIp,
  anonymizeIp,
} from '@/utils/helpers';
import logger from '@utils/logger';
import { sanitizeRegistrationInputsStrict } from '@utils/sanitizers/sanitizeRegistrationInputs';

// Créer le middleware de rate limiting spécifique pour l'inscription
const registrationRateLimit = applyRateLimit('AUTH_ENDPOINTS', {
  // Configuration personnalisée pour l'inscription
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 tentatives d'inscription par 15 minutes
  message:
    "Trop de tentatives d'inscription récentes. Veuillez réessayer dans quelques minutes.",
  skipSuccessfulRequests: true, // Ne pas compter les inscriptions réussies
  skipFailedRequests: false, // Compter les échecs d'inscription
  prefix: 'register', // Préfixe spécifique pour l'inscription

  // Fonction personnalisée pour générer la clé (basée sur IP + email)
  keyGenerator: (req) => {
    const ip = extractRealIp(req);

    // Essayer d'extraire l'email du body pour une limitation plus précise
    try {
      if (req.body) {
        const body =
          typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        if (body.email) {
          // Hasher l'email pour la confidentialité
          const emailHash = Buffer.from(body.email.toLowerCase())
            .toString('base64')
            .substring(0, 8);
          return `register:email:${emailHash}:ip:${ip}`;
        }
      }
    } catch (e) {
      // Fallback vers IP seulement si parsing échoue
    }

    return `register:ip:${ip}`;
  },
});

// Fonction pour générer les headers de sécurité spécifiques registration
const getRegistrationSecurityHeaders = (requestId, responseTime) => {
  return {
    // CORS spécifique registration
    'Access-Control-Allow-Origin':
      process.env.NEXT_PUBLIC_SITE_URL || 'same-origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',

    // Anti-cache ultra-strict
    'Cache-Control':
      'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    Pragma: 'no-cache',
    Expires: '0',
    'Surrogate-Control': 'no-store',

    // Sécurité renforcée pour données PII
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',

    // Isolation maximale pour auth
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Resource-Policy': 'same-site',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless',

    // CSP spécifique formulaires d'inscription
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'",

    // Permissions limitées pour auth
    'Permissions-Policy':
      'geolocation=(), microphone=(), camera=(), payment=(), usb=(), interest-cohort=()',

    // Headers spécifiques registration
    'X-API-Version': '1.0',
    'X-Transaction-Type': 'registration',
    'X-Operation-Type': 'user-creation',
    'X-Entity-Type': 'user-account',
    'X-Data-Sensitivity': 'high',
    'X-Authentication-Context': 'public-registration',
    'X-Password-Hashing': 'bcrypt',
    'X-PII-Processing': 'true',
    'X-RateLimit-Window': '900',
    'X-RateLimit-Limit': '5',
    'X-Rate-Limiting-Applied': 'true',
    'X-Rate-Limiting-Strategy': 'ip-email-combined',
    'X-Sanitization-Applied': 'true',
    'X-Yup-Validation-Applied': 'true',
    'X-Uniqueness-Check': 'email-required',
    'X-Database-Operations': '3',
    'X-Permitted-Cross-Domain-Policies': 'none',
    'X-Robots-Tag': 'noindex, nofollow',
    Vary: 'Content-Type, User-Agent',
    'X-Request-ID': requestId,
    'X-Response-Time': `${responseTime}ms`,
    'X-Content-Category': 'user-registration',
    'X-Operation-Criticality': 'high',
  };
};

export async function POST(req) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();

  // Capturer le début du processus d'inscription
  captureMessage('Registration process started', {
    level: 'info',
    tags: {
      component: 'registration',
      action: 'process_start',
      api_endpoint: '/api/register',
    },
    extra: {
      requestId,
      timestamp: new Date().toISOString(),
    },
  });

  try {
    // ===== ÉTAPE 1: APPLIQUER LE RATE LIMITING =====
    const rateLimitResponse = await registrationRateLimit(req);

    // Si le rate limiter retourne une réponse, cela signifie que la limite est dépassée
    if (rateLimitResponse) {
      // Capturer l'événement de rate limiting avec Sentry
      captureMessage('Registration rate limit exceeded', {
        level: 'warning',
        tags: {
          component: 'registration',
          action: 'rate_limit_exceeded',
          error_category: 'rate_limiting',
        },
        extra: {
          requestId,
          ip: anonymizeIp(extractRealIp(req)),
          userAgent:
            req.headers.get('user-agent')?.substring(0, 100) || 'unknown',
        },
      });

      // Ajouter les headers de sécurité même en cas de rate limiting
      const responseTime = Date.now() - startTime;
      const securityHeaders = getRegistrationSecurityHeaders(
        requestId,
        responseTime,
      );

      // Créer une nouvelle réponse avec les headers de sécurité
      return new NextResponse(rateLimitResponse.body, {
        status: 429,
        headers: {
          ...Object.fromEntries(rateLimitResponse.headers.entries()),
          ...securityHeaders,
        },
      });
    }

    // ===== ÉTAPE 2: PARSING DU BODY =====
    let body;
    try {
      body = await req.json();
    } catch (parseError) {
      const errorCategory = categorizeError(parseError);

      logger.error('JSON Parse Error during registration', {
        category: errorCategory,
        message: parseError.message,
        requestId,
      });

      // Capturer l'erreur de parsing avec Sentry
      captureException(parseError, {
        level: 'error',
        tags: {
          component: 'registration',
          action: 'json_parse_error',
          error_category: errorCategory,
        },
        extra: {
          requestId,
          contentType: req.headers.get('content-type'),
          userAgent: req.headers.get('user-agent')?.substring(0, 100),
        },
      });

      const responseTime = Date.now() - startTime;
      const securityHeaders = getRegistrationSecurityHeaders(
        requestId,
        responseTime,
      );

      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        {
          status: 400,
          headers: securityHeaders,
        },
      );
    }

    const {
      username,
      email,
      phone,
      password,
      confirmPassword,
      dateOfBirth,
      terms,
    } = body;

    // ===== ÉTAPE 2.5: SANITIZATION DES INPUTS =====
    const sanitizedInputs = sanitizeRegistrationInputsStrict({
      username,
      email,
      phone,
      password,
      confirmPassword,
      dateOfBirth,
      terms,
    });

    // Utiliser les données sanitizées pour la suite du processus
    const {
      username: sanitizedUsername,
      email: sanitizedEmail,
      phone: sanitizedPhone,
      password: sanitizedPassword,
      confirmPassword: sanitizedConfirmPassword,
      dateOfBirth: sanitizedDateOfBirth,
      terms: sanitizedTerms,
    } = sanitizedInputs;

    // Log sécurisé utilisant les fonctions d'anonymisation avec les données sanitizées
    const userDataForLogging = anonymizeUserData({
      username: sanitizedUsername,
      email: sanitizedEmail,
      phone: sanitizedPhone,
      dateOfBirth: sanitizedDateOfBirth,
    });

    logger.info('Registration attempt with sanitized data', {
      requestId,
      userContext: userDataForLogging,
    });

    // ===== ÉTAPE 3: VALIDATION =====
    try {
      // Validate input using Yup schema avec les données sanitizées
      await registrationSchema.validate(
        {
          username: sanitizedUsername,
          email: sanitizedEmail,
          phone: sanitizedPhone,
          password: sanitizedPassword,
          confirmPassword: sanitizedConfirmPassword,
          dateOfBirth: sanitizedDateOfBirth,
          terms: sanitizedTerms,
        },
        { abortEarly: false },
      );
    } catch (validationError) {
      const errorCategory = categorizeError(validationError);

      logger.error('Validation Error during registration', {
        category: errorCategory,
        failed_fields: validationError.inner?.map((err) => err.path) || [],
        total_errors: validationError.inner?.length || 0,
        user_input: userDataForLogging,
        requestId,
      });

      // Capturer l'erreur de validation avec Sentry
      captureValidationError(validationError, {
        tags: {
          component: 'registration',
          action: 'validation_failed',
          form: 'registration_form',
        },
        extra: {
          requestId,
          failedFields: validationError.inner?.map((err) => err.path) || [],
          totalErrors: validationError.inner?.length || 0,
          userContext: userDataForLogging,
        },
      });

      const errors = {};
      validationError.inner.forEach((error) => {
        errors[error.path] = error.message;
      });

      const responseTime = Date.now() - startTime;
      const securityHeaders = getRegistrationSecurityHeaders(
        requestId,
        responseTime,
      );

      return NextResponse.json(
        { errors },
        {
          status: 400,
          headers: securityHeaders,
        },
      );
    }

    // ===== ÉTAPE 4: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      logger.error('Database Connection Error during registration', {
        category: errorCategory,
        message: dbConnectionError.message,
        user_context: userDataForLogging,
        requestId,
      });

      // Capturer l'erreur de connexion DB avec Sentry
      captureDatabaseError(dbConnectionError, {
        tags: {
          component: 'registration',
          action: 'db_connection_failed',
          operation: 'connection',
        },
        extra: {
          requestId,
          timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
          userContext: userDataForLogging,
        },
      });

      const responseTime = Date.now() - startTime;
      const securityHeaders = getRegistrationSecurityHeaders(
        requestId,
        responseTime,
      );

      return NextResponse.json(
        { error: 'Database connection failed' },
        {
          status: 503,
          headers: securityHeaders,
        },
      );
    }

    // ===== ÉTAPE 5: VÉRIFICATION EXISTENCE UTILISATEUR =====
    let userExistsResult;
    try {
      const userExistsQuery =
        'SELECT user_id FROM admin.users WHERE user_email = $1';
      userExistsResult = await client.query(userExistsQuery, [
        sanitizedEmail.toLowerCase(),
      ]);
    } catch (userCheckError) {
      const errorCategory = categorizeError(userCheckError);

      logger.error('User Check Error during registration', {
        category: errorCategory,
        message: userCheckError.message,
        user_context: userDataForLogging,
        requestId,
      });

      // Capturer l'erreur de vérification utilisateur avec Sentry
      captureDatabaseError(userCheckError, {
        tags: {
          component: 'registration',
          action: 'user_check_failed',
          operation: 'SELECT',
        },
        extra: {
          requestId,
          table: 'admin.users',
          queryType: 'user_existence_check',
          userContext: userDataForLogging,
        },
      });

      if (client) await client.cleanup();

      const responseTime = Date.now() - startTime;
      const securityHeaders = getRegistrationSecurityHeaders(
        requestId,
        responseTime,
      );

      return NextResponse.json(
        { error: 'Database query failed during user check' },
        {
          status: 500,
          headers: securityHeaders,
        },
      );
    }

    if (userExistsResult.rows.length > 0) {
      logger.warn('User registration attempt with existing email', {
        user_context: userDataForLogging,
        requestId,
      });

      // Capturer la tentative d'inscription avec email existant
      captureMessage('Registration attempt with existing email', {
        level: 'warning',
        tags: {
          component: 'registration',
          action: 'duplicate_email_attempt',
          error_category: 'business_logic',
        },
        extra: {
          requestId,
          userContext: userDataForLogging,
        },
      });

      if (client) await client.cleanup();

      const responseTime = Date.now() - startTime;
      const securityHeaders = getRegistrationSecurityHeaders(
        requestId,
        responseTime,
      );

      return NextResponse.json(
        { error: 'A user with this email already exists' },
        {
          status: 400,
          headers: securityHeaders,
        },
      );
    }

    // ===== ÉTAPE 6: HACHAGE DU MOT DE PASSE =====
    let hashedPassword;
    try {
      const salt = await bcrypt.genSalt(10);
      hashedPassword = await bcrypt.hash(sanitizedPassword, salt);

      // Vérifier que le hachage a réussi
      if (!hashedPassword) {
        throw new Error('Password hashing returned empty result');
      }
    } catch (hashError) {
      const errorCategory = categorizeError(hashError);

      logger.error('Password Hashing Error during registration', {
        category: errorCategory,
        message: hashError.message,
        user_context: userDataForLogging,
        requestId,
      });

      // Capturer l'erreur de hachage avec Sentry
      captureException(hashError, {
        level: 'error',
        tags: {
          component: 'registration',
          action: 'password_hashing_failed',
          error_category: 'authentication',
        },
        extra: {
          requestId,
          algorithm: 'bcrypt',
          saltRounds: 10,
          bcryptVersion: 'bcryptjs',
          userContext: userDataForLogging,
        },
      });

      if (client) await client.cleanup();

      const responseTime = Date.now() - startTime;
      const securityHeaders = getRegistrationSecurityHeaders(
        requestId,
        responseTime,
      );

      return NextResponse.json(
        { error: 'Password processing failed' },
        {
          status: 500,
          headers: securityHeaders,
        },
      );
    }

    // ===== ÉTAPE 7: INSERTION NOUVEL UTILISATEUR =====
    let result;
    try {
      const insertUserQuery = `
        INSERT INTO admin.users (user_name, user_email, user_password, user_phone, user_birthdate)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING user_id, user_name, user_email, user_phone, user_birthdate, user_image, user_added, user_updated
      `;

      result = await client.query(insertUserQuery, [
        sanitizedUsername,
        sanitizedEmail.toLowerCase(),
        hashedPassword,
        sanitizedPhone || null,
        sanitizedDateOfBirth || null,
      ]);
    } catch (insertError) {
      const errorCategory = categorizeError(insertError);

      logger.error('User Insertion Error during registration', {
        category: errorCategory,
        postgres_error_code: insertError.code || 'unknown',
        user_context: userDataForLogging,
        requestId,
      });

      // Capturer l'erreur d'insertion avec Sentry
      captureDatabaseError(insertError, {
        tags: {
          component: 'registration',
          action: 'user_insertion_failed',
          operation: 'INSERT',
        },
        extra: {
          requestId,
          table: 'admin.users',
          postgresCode: insertError.code,
          postgresDetail: insertError.detail ? '[Filtered]' : undefined,
          constraintName: insertError.constraint,
          userContext: userDataForLogging,
        },
      });

      if (client) await client.cleanup();

      const responseTime = Date.now() - startTime;
      const securityHeaders = getRegistrationSecurityHeaders(
        requestId,
        responseTime,
      );

      // Retourner des erreurs spécifiques selon le type
      if (insertError.code === '23505') {
        // Unique violation
        return NextResponse.json(
          { error: 'A user with this email or username already exists' },
          {
            status: 400,
            headers: securityHeaders,
          },
        );
      }

      return NextResponse.json(
        { error: 'Failed to create user account' },
        {
          status: 500,
          headers: securityHeaders,
        },
      );
    }

    // ===== ÉTAPE 8: SUCCÈS - LOG ET NETTOYAGE =====
    const newUser = result.rows[0];
    const responseTime = Date.now() - startTime;

    logger.info('User registration successful', {
      user: anonymizeUserData(newUser),
      response_time_ms: responseTime,
      success: true,
      requestId,
    });

    // Capturer le succès de l'inscription avec Sentry
    captureMessage('User registration completed successfully', {
      level: 'info',
      tags: {
        component: 'registration',
        action: 'registration_success',
        success: 'true',
      },
      extra: {
        requestId,
        userId: newUser.user_id,
        responseTimeMs: responseTime,
        databaseOperations: 3,
        rateLimitingApplied: true,
        userContext: anonymizeUserData(newUser),
      },
    });

    if (client) await client.cleanup();

    // Générer les headers de sécurité pour la réponse de succès
    const securityHeaders = getRegistrationSecurityHeaders(
      requestId,
      responseTime,
    );

    return NextResponse.json(
      {
        message: 'User registered successfully',
        user: {
          id: newUser.user_id,
          username: newUser.user_name,
          email: newUser.user_email,
          created_at: newUser.user_added,
        },
      },
      {
        status: 201,
        headers: securityHeaders,
      },
    );
  } catch (error) {
    // ===== GESTION GLOBALE DES ERREURS =====
    const errorCategory = categorizeError(error);
    const responseTime = Date.now() - startTime;

    logger.error('Global Registration Error', {
      category: errorCategory,
      response_time_ms: responseTime,
      error_message: error.message,
      requestId,
    });

    // Capturer l'erreur globale avec Sentry
    captureException(error, {
      level: 'error',
      tags: {
        component: 'registration',
        action: 'global_error_handler',
        error_category: errorCategory,
        critical: 'true',
      },
      extra: {
        requestId,
        responseTimeMs: responseTime,
        reachedGlobalHandler: true,
        errorName: error.name,
        stackAvailable: !!error.stack,
        rateLimitingContext: true,
        process: 'user_registration',
      },
    });

    if (client) await client.cleanup();

    // Générer les headers de sécurité même en cas d'erreur globale
    const securityHeaders = getRegistrationSecurityHeaders(
      requestId,
      responseTime,
    );

    return NextResponse.json(
      { error: 'Internal server error' },
      {
        status: 500,
        headers: securityHeaders,
      },
    );
  }
}
