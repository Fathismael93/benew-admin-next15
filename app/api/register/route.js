// api/register/route.js
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getClient } from '@/utils/dbConnect';
import { registrationSchema } from '@/utils/schemas';

// ----- FONCTIONS UTILITAIRES SEULEMENT -----

// Fonction pour détecter les données sensibles
function containsSensitiveData(str) {
  if (!str || typeof str !== 'string') return false;

  const patterns = [
    /password/i,
    /mot\s*de\s*passe/i,
    /nextauth[_-]?secret/i,
    /jwt[_-]?token/i,
    /access[_-]?token/i,
    /refresh[_-]?token/i,
    /session[_-]?token/i,
    /api[_-]?key/i,
    /secret[_-]?key/i,
    /cloudinary[_-]?api[_-]?secret/i,
    /db[_-]?password/i,
    /database[_-]?password/i,
    /sentry[_-]?auth[_-]?token/i,
    /credit\s*card/i,
    /carte\s*de\s*credit/i,
    /payment[_-]?method/i,
    /card[_-]?number/i,
    /cvv/i,
    /expiry/i,
    /\b(?:\d{4}[ -]?){3}\d{4}\b/,
    /\b(?:\d{3}[ -]?){2}\d{4}\b/,
    /\b\d{3}[ -]?\d{2}[ -]?\d{4}\b/,
    /user[_-]?password/i,
    /email[_-]?verification/i,
    /reset[_-]?token/i,
    /verification[_-]?code/i,
    /platform[_-]?number/i,
    /application[_-]?price/i,
    /order[_-]?payment/i,
  ];

  return patterns.some((pattern) => pattern.test(str));
}

// Classification des erreurs
function categorizeError(error) {
  if (!error) return 'unknown';

  const message = error.message || '';
  const name = error.name || '';
  const stack = error.stack || '';
  const combinedText = (message + name + stack).toLowerCase();

  if (/postgres|pg|database|db|connection|timeout|pool/i.test(combinedText)) {
    return 'database';
  }

  if (
    /nextauth|auth|permission|token|unauthorized|forbidden|session/i.test(
      combinedText,
    )
  ) {
    return 'authentication';
  }

  if (/cloudinary|image|upload|transform|media/i.test(combinedText)) {
    return 'media_upload';
  }

  if (/network|fetch|http|request|response|api|axios/i.test(combinedText)) {
    return 'network';
  }

  if (/validation|schema|required|invalid|yup/i.test(combinedText)) {
    return 'validation';
  }

  if (/tiptap|editor|prosemirror/i.test(combinedText)) {
    return 'editor';
  }

  if (
    /template|application|article|blog|platform|order|user/i.test(combinedText)
  ) {
    return 'business_logic';
  }

  if (/rate.?limit|too.?many.?requests|429/i.test(combinedText)) {
    return 'rate_limiting';
  }

  return 'application';
}

// Anonymisation des données utilisateur
function anonymizeUserData(userData) {
  if (!userData) return userData;

  const anonymizedData = { ...userData };

  // Supprimer les informations très sensibles
  delete anonymizedData.ip_address;
  delete anonymizedData.user_password;
  delete anonymizedData.session_token;

  // Anonymiser le nom d'utilisateur
  if (anonymizedData.username || anonymizedData.user_name) {
    const username = anonymizedData.username || anonymizedData.user_name;
    anonymizedData.username =
      username.length > 2
        ? username[0] + '***' + username.slice(-1)
        : '[USERNAME]';
    delete anonymizedData.user_name;
  }

  // Anonymiser l'email
  if (anonymizedData.email || anonymizedData.user_email) {
    const email = anonymizedData.email || anonymizedData.user_email;
    const atIndex = email.indexOf('@');
    if (atIndex > 0) {
      const domain = email.slice(atIndex);
      anonymizedData.email = `${email[0]}***${domain}`;
    } else {
      anonymizedData.email = '[FILTERED_EMAIL]';
    }
    delete anonymizedData.user_email;
  }

  // Anonymiser l'ID utilisateur
  if (anonymizedData.id || anonymizedData.user_id) {
    const id = String(anonymizedData.id || anonymizedData.user_id);
    anonymizedData.id =
      id.length > 2 ? id.substring(0, 1) + '***' + id.slice(-1) : '[USER_ID]';
    delete anonymizedData.user_id;
  }

  // Anonymiser le téléphone
  if (anonymizedData.phone || anonymizedData.user_phone) {
    const phone = anonymizedData.phone || anonymizedData.user_phone;
    anonymizedData.phone =
      phone.length > 4
        ? phone.substring(0, 2) + '***' + phone.slice(-2)
        : '[PHONE]';
    delete anonymizedData.user_phone;
  }

  return anonymizedData;
}

// Filtrage du corps des requêtes
function filterRequestBody(body) {
  if (!body) return body;

  if (containsSensitiveData(body)) {
    try {
      if (typeof body === 'string') {
        const parsedBody = JSON.parse(body);
        const sensitiveFields = [
          'password',
          'confirmPassword',
          'user_password',
          'api_key',
          'secret',
          'token',
          'auth',
          'cloudinary_secret',
          'db_password',
          'platform_number',
          'payment_info',
          'card_number',
          'cvv',
          'expiry',
        ];

        const filteredBody = { ...parsedBody };
        sensitiveFields.forEach((field) => {
          if (filteredBody[field]) {
            filteredBody[field] = '[FILTERED]';
          }
        });

        return {
          filtered: '[CONTIENT DES DONNÉES SENSIBLES]',
          bodySize: JSON.stringify(parsedBody).length,
          sanitizedPreview:
            JSON.stringify(filteredBody).substring(0, 200) + '...',
        };
      }
    } catch (e) {
      // Parsing JSON échoué
    }
    return '[DONNÉES FILTRÉES]';
  }

  return body;
}

// ----- API ROUTE PRINCIPALE (SANS SENTRY) -----

export async function POST(req) {
  let client;
  const startTime = Date.now();

  console.log('🚀 Registration API called at:', new Date().toISOString());

  try {
    // Parse the request body
    let body;
    try {
      body = await req.json();
    } catch (parseError) {
      const errorCategory = categorizeError(parseError);

      console.error('❌ JSON Parse Error:', {
        category: errorCategory,
        message: parseError.message,
        headers: {
          'content-type': req.headers.get('content-type'),
          'user-agent': req.headers.get('user-agent'),
        },
      });

      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 },
      );
    }

    const { username, email, phone, password, dateOfBirth } = body;

    // Vérifier si le corps de la requête contient des données sensibles
    const bodyString = JSON.stringify(body);
    if (containsSensitiveData(bodyString)) {
      console.log(
        '⚠️ Registration attempt detected with sensitive data patterns',
      );
    }

    // Filtrer les données sensibles du corps de la requête
    const filteredBody = filterRequestBody(bodyString);

    // Log sécurisé utilisant les fonctions d'anonymisation
    const userDataForLogging = anonymizeUserData({
      username,
      email,
      phone,
      dateOfBirth,
    });

    console.log('📝 Registration attempt:', userDataForLogging);

    // Validate input using Yup schema
    try {
      await registrationSchema.validate(
        { username, email, phone, password, confirmPassword, dateOfBirth },
        { abortEarly: false },
      );
    } catch (validationError) {
      const errorCategory = categorizeError(validationError);

      console.error('❌ Validation Error:', {
        category: errorCategory,
        failed_fields: validationError.inner?.map((err) => err.path) || [],
        total_errors: validationError.inner?.length || 0,
        user_input: userDataForLogging,
      });

      const errors = {};
      validationError.inner.forEach((error) => {
        errors[error.path] = error.message;
      });
      return NextResponse.json({ errors }, { status: 400 });
    }

    // Obtenir le client de base de données
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
      });

      return NextResponse.json(
        { error: 'Database connection failed' },
        { status: 503 },
      );
    }

    // Check if user already exists
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

      if (client) await client.cleanup();
      return NextResponse.json(
        { error: 'A user with this email already exists' },
        { status: 400 },
      );
    }

    // Hash password
    let hashedPassword;
    try {
      // Vérifier si le mot de passe contient des données sensibles (patterns suspects)
      if (containsSensitiveData(password)) {
        console.warn('⚠️ Password contains potentially sensitive patterns');
      }

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
      });

      if (client) await client.cleanup();
      return NextResponse.json(
        { error: 'Password processing failed' },
        { status: 500 },
      );
    }

    // Insert new user
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

      // Analyser le type d'erreur PostgreSQL
      let errorDetails = {
        postgres_code: insertError.code,
        postgres_detail: insertError.detail,
        constraint_name: insertError.constraint,
      };

      // Filtrer les détails sensibles
      if (containsSensitiveData(JSON.stringify(errorDetails))) {
        errorDetails = {
          ...errorDetails,
          postgres_detail: '[FILTERED - Contains sensitive data]',
        };
      }

      console.error('❌ User Insertion Error:', {
        category: errorCategory,
        postgres_error_code: insertError.code || 'unknown',
        operation: 'INSERT INTO users',
        table: 'users',
        error_details: errorDetails,
        user_context: userDataForLogging,
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

    // Success - Log et nettoyer
    const newUser = result.rows[0];
    const responseTime = Date.now() - startTime;

    console.log('🎉 User registration successful:', {
      user: anonymizeUserData(newUser),
      response_time_ms: responseTime,
      database_operations: 3, // connection + check + insert
      success: true,
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
    // Gestion globale des erreurs non anticipées
    const errorCategory = categorizeError(error);
    const responseTime = Date.now() - startTime;

    // Vérifier si l'erreur contient des données sensibles
    const errorMessage = containsSensitiveData(error.message)
      ? '[FILTERED - Error contains sensitive data]'
      : error.message;

    console.error('💥 Global Registration Error:', {
      category: errorCategory,
      response_time_ms: responseTime,
      reached_global_handler: true,
      error_name: error.name,
      error_message: errorMessage,
      stack_available: !!error.stack,
    });

    if (client) await client.cleanup();

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
