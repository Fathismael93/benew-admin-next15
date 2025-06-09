/* eslint-disable no-unused-vars */
// instrumentation.js
import { EventEmitter } from 'events';

// Augmenter la limite d'écouteurs d'événements pour éviter l'avertissement
if (typeof EventEmitter !== 'undefined') {
  EventEmitter.defaultMaxListeners = 25;
}

// ----- FONCTIONS CENTRALISÉES D'ANONYMISATION ET DE FILTRAGE -----

// Fonction pour valider le format d'un DSN Sentry
function isValidDSN(dsn) {
  if (!dsn) return false;
  // Format approximatif d'un DSN valide: https://{PUBLIC_KEY}@{HOST}/{PROJECT_ID}
  return /^https:\/\/[^@]+@[^/]+\/\d+$/.test(dsn);
}

// Fonction pour détecter les données sensibles spécifiques au dashboard admin
function containsSensitiveData(str) {
  if (!str || typeof str !== 'string') return false;

  // Patterns pour détecter les données sensibles spécifiques à votre application
  const patterns = [
    // Authentification et tokens
    /password/i,
    /mot\s*de\s*passe/i,
    /nextauth[_-]?secret/i,
    /jwt[_-]?token/i,
    /access[_-]?token/i,
    /refresh[_-]?token/i,
    /session[_-]?token/i,

    // API Keys et secrets
    /api[_-]?key/i,
    /secret[_-]?key/i,
    /cloudinary[_-]?api[_-]?secret/i,
    /db[_-]?password/i,
    /database[_-]?password/i,
    /sentry[_-]?auth[_-]?token/i,

    // Données bancaires et paiement
    /credit\s*card/i,
    /carte\s*de\s*credit/i,
    /payment[_-]?method/i,
    /card[_-]?number/i,
    /cvv/i,
    /expiry/i,

    // Numéros sensibles
    /\b(?:\d{4}[ -]?){3}\d{4}\b/, // Numéros de carte
    /\b(?:\d{3}[ -]?){2}\d{4}\b/, // Numéros de téléphone
    /\b\d{3}[ -]?\d{2}[ -]?\d{4}\b/, // SSN

    // Données utilisateurs sensibles
    /user[_-]?password/i,
    /email[_-]?verification/i,
    /reset[_-]?token/i,
    /verification[_-]?code/i,

    // Données spécifiques au projet
    /platform[_-]?number/i, // Numéros de plateforme de paiement
    /application[_-]?price/i,
    /order[_-]?payment/i,
  ];

  return patterns.some((pattern) => pattern.test(str));
}

// Classification des erreurs par catégorie pour votre application dashboard
function categorizeError(error) {
  if (!error) return 'unknown';

  const message = error.message || '';
  const name = error.name || '';
  const stack = error.stack || '';
  const combinedText = (message + name + stack).toLowerCase();

  // Erreurs de base de données PostgreSQL
  if (/postgres|pg|database|db|connection|timeout|pool/i.test(combinedText)) {
    return 'database';
  }

  // Erreurs d'authentification NextAuth
  if (
    /nextauth|auth|permission|token|unauthorized|forbidden|session/i.test(
      combinedText,
    )
  ) {
    return 'authentication';
  }

  // Erreurs Cloudinary
  if (/cloudinary|image|upload|transform|media/i.test(combinedText)) {
    return 'media_upload';
  }

  // Erreurs API et réseau
  if (/network|fetch|http|request|response|api|axios/i.test(combinedText)) {
    return 'network';
  }

  // Erreurs de validation Yup
  if (/validation|schema|required|invalid|yup/i.test(combinedText)) {
    return 'validation';
  }

  // Erreurs TipTap Editor
  if (/tiptap|editor|prosemirror/i.test(combinedText)) {
    return 'editor';
  }

  // Erreurs spécifiques aux entités métier
  if (
    /template|application|article|blog|platform|order|user/i.test(combinedText)
  ) {
    return 'business_logic';
  }

  // Erreurs de rate limiting
  if (/rate.?limit|too.?many.?requests|429/i.test(combinedText)) {
    return 'rate_limiting';
  }

  return 'application';
}

// ----- FONCTIONS CENTRALISÉES D'ANONYMISATION ADAPTÉES -----

// Fonction centralisée pour anonymiser les URLs spécifiques au dashboard
function anonymizeUrl(url) {
  if (!url) return url;

  try {
    const urlObj = new URL(url);

    // Paramètres sensibles spécifiques à votre application
    const sensitiveParams = [
      'token',
      'password',
      'accessToken',
      'refreshToken',
      'sessionToken',
      'key',
      'secret',
      'auth',
      'api_key',
      'apikey',
      'pass',
      'pwd',
      'credential',
      'nextauth_secret',
      'cloudinary_secret',
      'sentry_token',
      'db_password',
      'verification_code',
      'reset_token',
    ];

    let hasFilteredParams = false;
    sensitiveParams.forEach((param) => {
      if (urlObj.searchParams.has(param)) {
        urlObj.searchParams.set(param, '[FILTERED]');
        hasFilteredParams = true;
      }
    });

    // Masquer les IDs dans les URLs pour protéger l'identité
    const pathSegments = urlObj.pathname.split('/');
    const maskedSegments = pathSegments.map((segment, index) => {
      // Si c'est un ID numérique, le masquer partiellement
      if (/^\d+$/.test(segment) && segment.length > 2) {
        return segment.substring(0, 1) + '***' + segment.slice(-1);
      }
      return segment;
    });

    if (maskedSegments.join('/') !== urlObj.pathname) {
      urlObj.pathname = maskedSegments.join('/');
      hasFilteredParams = true;
    }

    return hasFilteredParams ? urlObj.toString() : url;
  } catch (e) {
    // En cas d'erreur de parsing, retourner une version sécurisée
    return '[URL_PARSING_ERROR]';
  }
}

// Fonction centralisée pour anonymiser les données utilisateur du dashboard
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

// Fonction centralisée pour anonymiser les headers
function anonymizeHeaders(headers) {
  if (!headers) return headers;

  const sanitizedHeaders = { ...headers };

  // Headers sensibles spécifiques à votre stack
  const sensitiveHeaders = [
    'cookie',
    'authorization',
    'x-auth-token',
    'x-session-token',
    'session',
    'x-api-key',
    'token',
    'auth',
    'nextauth.session-token',
    'cloudinary-auth',
    'x-csrf-token',
    'x-forwarded-for', // IP potentiellement sensible
  ];

  sensitiveHeaders.forEach((header) => {
    const lowerHeader = header.toLowerCase();
    Object.keys(sanitizedHeaders).forEach((key) => {
      if (key.toLowerCase() === lowerHeader) {
        sanitizedHeaders[key] = '[FILTERED]';
      }
    });
  });

  return sanitizedHeaders;
}

// Fonction centralisée pour filtrer le corps des requêtes
function filterRequestBody(body) {
  if (!body) return body;

  if (containsSensitiveData(body)) {
    try {
      if (typeof body === 'string') {
        const parsedBody = JSON.parse(body);

        // Spécifiquement filtrer les champs sensibles de votre application
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

export async function register() {
  const sentryDSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
  const environment = process.env.NODE_ENV || 'development';
  const isProduction = environment === 'production';

  if (sentryDSN && isValidDSN(sentryDSN)) {
    try {
      const Sentry = await import('@sentry/nextjs');

      Sentry.init({
        dsn: sentryDSN,
        environment,
        release:
          process.env.SENTRY_RELEASE ||
          process.env.VERCEL_GIT_COMMIT_SHA ||
          '0.1.0',
        debug: !isProduction,
        enabled: isProduction,

        // Configuration spécifique pour votre application dashboard
        tracesSampleRate: isProduction ? 0.1 : 1.0,
        profilesSampleRate: isProduction ? 0.1 : 1.0,

        // Intégrations spécifiques
        integrations: [
          new Sentry.Replay({
            maskAllText: true,
            blockAllMedia: true,
            maskAllInputs: true,
            blockClass: 'sentry-block',
            maskClass: 'sentry-mask',
          }),
        ],

        // Erreurs à ignorer spécifiques à votre stack
        ignoreErrors: [
          // Erreurs réseau
          'Connection refused',
          'Connection reset',
          'ECONNREFUSED',
          'ECONNRESET',
          'socket hang up',
          'ETIMEDOUT',
          'read ECONNRESET',
          'connect ETIMEDOUT',
          'Network request failed',

          // Erreurs PostgreSQL communes
          'Connection terminated',
          'Client has encountered a connection error',
          'Connection timeout',
          'ENOTFOUND',
          'ECONNABORTED',

          // Erreurs Next.js / NextAuth
          'NEXT_REDIRECT',
          'NEXT_NOT_FOUND',
          'Cancelled',
          'Route cancelled',
          'NextAuthError',
          'OAuthCallbackError',

          // Erreurs Cloudinary
          'Upload failed',
          'Resource not found',
          'Invalid signature',

          // Erreurs de parsing
          'Unexpected token',
          'SyntaxError',
          'JSON.parse',
          'Unexpected end of JSON input',

          // Erreurs d'opérations abandonnées
          'AbortError',
          'Operation was aborted',
          'Request aborted',

          // Erreurs de validation Yup
          'ValidationError',
          'yup validation error',

          // Erreurs TipTap
          'ProseMirror',
          'Editor transaction',

          // Rate limiting (erreurs normales)
          'Rate limit exceeded',
          'Too many requests',
        ],

        beforeBreadcrumb(breadcrumb, hint) {
          // Éviter d'enregistrer des informations sensibles dans les breadcrumbs
          if (
            ['xhr', 'fetch'].includes(breadcrumb.category) &&
            breadcrumb.data
          ) {
            // Filtrer les URLs sensibles
            if (breadcrumb.data.url) {
              breadcrumb.data.url = anonymizeUrl(breadcrumb.data.url);
            }

            // Filtrer les corps de requête
            if (breadcrumb.data.body) {
              const filteredResult = filterRequestBody(breadcrumb.data.body);
              if (
                typeof filteredResult === 'object' &&
                filteredResult.filtered
              ) {
                breadcrumb.data.body = filteredResult.filtered;
                breadcrumb.data.bodySize = filteredResult.bodySize;
              } else if (filteredResult !== breadcrumb.data.body) {
                breadcrumb.data.body = filteredResult;
              }
            }

            // Filtrer les headers de response
            if (breadcrumb.data.response_headers) {
              breadcrumb.data.response_headers = anonymizeHeaders(
                breadcrumb.data.response_headers,
              );
            }
          }

          // Filtrer les breadcrumbs de console pour éviter les logs sensibles
          if (breadcrumb.category === 'console' && breadcrumb.message) {
            if (containsSensitiveData(breadcrumb.message)) {
              breadcrumb.message =
                '[Log filtré contenant des données sensibles]';
            }
          }

          return breadcrumb;
        },

        beforeSend(event, hint) {
          const error = hint && hint.originalException;

          // Ajouter la catégorie d'erreur spécifique à votre application
          if (error) {
            event.tags = event.tags || {};
            event.tags.error_category = categorizeError(error);

            // Ajouter des tags spécifiques au contexte de votre application
            if (event.request && event.request.url) {
              const url = event.request.url;
              if (url.includes('/api/dashboard/')) {
                event.tags.api_type = 'dashboard_api';

                // Identifier le type d'entité
                if (url.includes('/templates/')) event.tags.entity = 'template';
                else if (url.includes('/applications/'))
                  event.tags.entity = 'application';
                else if (url.includes('/blog/')) event.tags.entity = 'blog';
                else if (url.includes('/platforms/'))
                  event.tags.entity = 'platform';
                else if (url.includes('/orders/')) event.tags.entity = 'order';
                else if (url.includes('/users/')) event.tags.entity = 'user';
              } else if (url.includes('/api/auth/')) {
                event.tags.api_type = 'auth_api';
              } else if (url.includes('/api/register')) {
                event.tags.api_type = 'registration_api';
              }
            }
          }

          // Anonymiser les headers
          if (event.request && event.request.headers) {
            event.request.headers = anonymizeHeaders(event.request.headers);
          }

          // Anonymiser les cookies
          if (event.request && event.request.cookies) {
            event.request.cookies = '[FILTERED]';
          }

          // Anonymiser les données utilisateurs
          if (event.user) {
            event.user = anonymizeUserData(event.user);
          }

          // Anonymiser les URL
          if (event.request && event.request.url) {
            event.request.url = anonymizeUrl(event.request.url);
          }

          // Filtrer les messages d'erreur sensibles
          if (event.message && containsSensitiveData(event.message)) {
            event.message = `[Message filtré] ${event.message.substring(0, 50)}...`;
          }

          // Filtrer les données sensibles dans les frames de stack
          if (event.exception && event.exception.values) {
            event.exception.values.forEach((exceptionValue) => {
              if (
                exceptionValue.stacktrace &&
                exceptionValue.stacktrace.frames
              ) {
                exceptionValue.stacktrace.frames.forEach((frame) => {
                  if (frame.vars) {
                    Object.keys(frame.vars).forEach((key) => {
                      const value = String(frame.vars[key] || '');
                      if (
                        containsSensitiveData(key) ||
                        containsSensitiveData(value)
                      ) {
                        frame.vars[key] = '[FILTERED]';
                      }
                    });
                  }

                  // Filtrer les chemins de fichiers potentiellement sensibles
                  if (
                    frame.filename &&
                    frame.filename.includes('node_modules')
                  ) {
                    frame.filename = frame.filename.replace(
                      /.*node_modules/,
                      '[...]/node_modules',
                    );
                  }
                });
              }
            });
          }

          // Filtrer les données dans les contextes
          if (event.contexts) {
            Object.keys(event.contexts).forEach((contextKey) => {
              const context = event.contexts[contextKey];
              if (typeof context === 'object' && context !== null) {
                Object.keys(context).forEach((key) => {
                  const value = String(context[key] || '');
                  if (
                    containsSensitiveData(key) ||
                    containsSensitiveData(value)
                  ) {
                    context[key] = '[FILTERED]';
                  }
                });
              }
            });
          }

          return event;
        },
      });

      console.log('✅ Sentry initialized successfully for Admin Dashboard');
    } catch (error) {
      console.error('❌ Failed to initialize Sentry:', error);
    }
  } else {
    console.warn(
      '⚠️ Invalid or missing Sentry DSN. Sentry will not be initialized.',
    );
  }
}

// Instrumentation pour les erreurs de requête spécifiques au dashboard
export async function onRequestError({ error, request }) {
  try {
    const Sentry = await import('@sentry/nextjs');

    // Contexte enrichi spécifique à votre application dashboard
    const context = {
      route: request.url,
      method: request.method,
      headers: {},
      errorCategory: categorizeError(error),
      timestamp: new Date().toISOString(),
    };

    // Identifier le type d'API pour un meilleur debugging
    if (request.url) {
      if (request.url.includes('/api/dashboard/')) {
        context.apiType = 'dashboard';

        // Extraire l'entité métier
        if (request.url.includes('/templates/')) context.entity = 'template';
        else if (request.url.includes('/applications/'))
          context.entity = 'application';
        else if (request.url.includes('/blog/')) context.entity = 'blog';
        else if (request.url.includes('/platforms/'))
          context.entity = 'platform';
        else if (request.url.includes('/orders/')) context.entity = 'order';
        else if (request.url.includes('/users/')) context.entity = 'user';
      } else if (request.url.includes('/api/auth/')) {
        context.apiType = 'authentication';
      } else if (request.url.includes('/api/register')) {
        context.apiType = 'registration';
      }
    }

    // Headers sécurisés pour le debugging
    const safeHeaders = [
      'user-agent',
      'referer',
      'accept-language',
      'content-type',
      'accept',
      'content-length',
    ];

    safeHeaders.forEach((header) => {
      const value =
        request.headers && request.headers.get && request.headers.get(header);
      if (value) {
        context.headers[header] = value;
      }
    });

    // Ajouter le contexte à Sentry
    Sentry.setContext('request', context);

    // Informations utilisateur anonymisées
    if (request.auth && request.auth.userId) {
      const userId = String(request.auth.userId);
      Sentry.setUser({
        id:
          userId.length > 2
            ? userId.substring(0, 1) + '***' + userId.slice(-1)
            : '[USER]',
        role: request.auth.role || 'user',
        type: 'dashboard_user',
      });
    }

    // Tags spécifiques pour le filtrage dans Sentry
    const tags = {
      component: 'server',
      error_category: categorizeError(error),
      api_type: context.apiType || 'unknown',
    };

    if (context.entity) {
      tags.entity = context.entity;
    }

    // Capturer l'erreur avec contexte enrichi
    Sentry.captureException(error, {
      tags,
      level: error.name === 'ValidationError' ? 'warning' : 'error',
    });
  } catch (sentryError) {
    console.error('❌ Error in onRequestError instrumentation:', sentryError);
  }
}
