// api/register/route.js
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getClient } from '@backend/dbConnect';
import { registrationSchema } from '@utils/schemas/registrationSchema';
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

// ----- FONCTIONS UTILITAIRES IMPORTÉES -----
// Note: Les fonctions utilitaires sont maintenant centralisées dans instrumentation.js

// ----- CONFIGURATION DU RATE LIMITING POUR L'INSCRIPTION -----

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

// ----- API ROUTE PRINCIPALE AVEC RATE LIMITING ET MONITORING SENTRY -----

export async function POST(req) {
  let client;
  const startTime = Date.now();
  const requestId = generateRequestId();

  console.log(
    '🚀 Registration API called at:',
    new Date().toISOString(),
    '| Request ID:',
    requestId,
  );

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
    console.log('🛡️ Applying rate limiting for registration...');

    const rateLimitResponse = await registrationRateLimit(req);

    // Si le rate limiter retourne une réponse, cela signifie que la limite est dépassée
    if (rateLimitResponse) {
      console.warn('⚠️ Registration rate limit exceeded');

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

      return rateLimitResponse; // Retourner directement la réponse 429
    }

    console.log('✅ Rate limiting passed');

    // ===== ÉTAPE 2: PARSING DU BODY =====
    let body;
    try {
      body = await req.json();
    } catch (parseError) {
      const errorCategory = categorizeError(parseError);

      console.error('❌ JSON Parse Error:', {
        category: errorCategory,
        message: parseError.message,
        requestId,
        headers: {
          'content-type': req.headers.get('content-type'),
          'user-agent': req.headers.get('user-agent'),
        },
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

      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 },
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

    // Log sécurisé utilisant les fonctions d'anonymisation
    const userDataForLogging = anonymizeUserData({
      username,
      email,
      phone,
      dateOfBirth,
    });

    console.log('📝 Registration attempt:', userDataForLogging);

    // ===== ÉTAPE 3: VALIDATION =====
    try {
      // Validate input using Yup schema
      await registrationSchema.validate(
        {
          username,
          email,
          phone,
          password,
          confirmPassword,
          dateOfBirth,
          terms,
        },
        { abortEarly: false },
      );
    } catch (validationError) {
      const errorCategory = categorizeError(validationError);

      console.error('❌ Validation Error:', {
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
      return NextResponse.json({ errors }, { status: 400 });
    }

    // ===== ÉTAPE 4: CONNEXION BASE DE DONNÉES =====
    try {
      client = await getClient();
      console.log('✅ Database connection successful');
    } catch (dbConnectionError) {
      const errorCategory = categorizeError(dbConnectionError);

      console.error('❌ Database Connection Error:', {
        category: errorCategory,
        message: dbConnectionError.message,
        timeout: process.env.CONNECTION_TIMEOUT || 'not_set',
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

      return NextResponse.json(
        { error: 'Database connection failed' },
        { status: 503 },
      );
    }

    // ===== ÉTAPE 5: VÉRIFICATION EXISTENCE UTILISATEUR =====
    let userExistsResult;
    try {
      const userExistsQuery =
        'SELECT user_id FROM admin.users WHERE user_email = $1';
      userExistsResult = await client.query(userExistsQuery, [
        email.toLowerCase(),
      ]);
      console.log('✅ User existence check completed');
    } catch (userCheckError) {
      const errorCategory = categorizeError(userCheckError);

      console.error('❌ User Check Error:', {
        category: errorCategory,
        message: userCheckError.message,
        query: 'user_existence_check',
        table: 'users',
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
      return NextResponse.json(
        { error: 'Database query failed during user check' },
        { status: 500 },
      );
    }

    if (userExistsResult.rows.length > 0) {
      console.log(
        '⚠️ User registration attempt with existing email:',
        userDataForLogging,
      );

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
      return NextResponse.json(
        { error: 'A user with this email already exists' },
        { status: 400 },
      );
    }

    // ===== ÉTAPE 6: HACHAGE DU MOT DE PASSE =====
    let hashedPassword;
    try {
      const salt = await bcrypt.genSalt(10);
      hashedPassword = await bcrypt.hash(password, salt);

      // Vérifier que le hachage a réussi
      if (!hashedPassword) {
        throw new Error('Password hashing returned empty result');
      }

      console.log('✅ Password hashed successfully');
    } catch (hashError) {
      const errorCategory = categorizeError(hashError);

      console.error('❌ Password Hashing Error:', {
        category: errorCategory,
        message: hashError.message,
        algorithm: 'bcrypt',
        salt_rounds: 10,
        bcrypt_version: 'bcryptjs',
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
      return NextResponse.json(
        { error: 'Password processing failed' },
        { status: 500 },
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
        username,
        email.toLowerCase(),
        hashedPassword,
        phone || null,
        dateOfBirth || null,
      ]);
      console.log('✅ User inserted successfully');
    } catch (insertError) {
      const errorCategory = categorizeError(insertError);

      console.error('❌ User Insertion Error:', {
        category: errorCategory,
        postgres_error_code: insertError.code || 'unknown',
        operation: 'INSERT INTO users',
        table: 'users',
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

      // Retourner des erreurs spécifiques selon le type
      if (insertError.code === '23505') {
        // Unique violation
        return NextResponse.json(
          { error: 'A user with this email or username already exists' },
          { status: 400 },
        );
      }

      return NextResponse.json(
        { error: 'Failed to create user account' },
        { status: 500 },
      );
    }

    // ===== ÉTAPE 8: SUCCÈS - LOG ET NETTOYAGE =====
    const newUser = result.rows[0];
    const responseTime = Date.now() - startTime;

    console.log('🎉 User registration successful:', {
      user: anonymizeUserData(newUser),
      response_time_ms: responseTime,
      database_operations: 3, // connection + check + insert
      success: true,
      rate_limiting_applied: true,
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
      { status: 201 },
    );
  } catch (error) {
    // ===== GESTION GLOBALE DES ERREURS =====
    const errorCategory = categorizeError(error);
    const responseTime = Date.now() - startTime;

    console.error('💥 Global Registration Error:', {
      category: errorCategory,
      response_time_ms: responseTime,
      reached_global_handler: true,
      error_name: error.name,
      error_message: error.message,
      stack_available: !!error.stack,
      rate_limiting_context: true,
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

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
