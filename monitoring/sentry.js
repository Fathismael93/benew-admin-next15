// monitoring/sentry.js
import * as Sentry from '@sentry/nextjs';

/**
 * Initialise et configure Sentry pour la surveillance des erreurs
 * Optimisé pour un dashboard d'administration e-commerce avec Next.js, PostgreSQL et NextAuth
 */
export const initSentry = () => {
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      environment: process.env.NODE_ENV,
      enabled: process.env.NODE_ENV === 'production',

      // Release tracking pour le déploiement
      release:
        process.env.SENTRY_RELEASE ||
        process.env.VERCEL_GIT_COMMIT_SHA ||
        '1.0.0',

      // Sampling pour optimiser les performances
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
      profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

      // Configurer les erreurs ignorées spécifiques au projet
      ignoreErrors: [
        // Erreurs réseau communes
        'Network request failed',
        'Failed to fetch',
        'NetworkError',
        'AbortError',
        'TypeError: Failed to fetch',
        'ECONNRESET',
        'ECONNREFUSED',
        'ETIMEDOUT',
        'socket hang up',

        // Erreurs PostgreSQL communes (non critiques)
        'Connection terminated',
        'Client has encountered a connection error',
        'Connection timeout',
        'connection not available',

        // Erreurs NextAuth
        'NEXT_REDIRECT',
        'NEXT_NOT_FOUND',
        'NextAuthError',
        'OAuthCallbackError',
        'SessionProviderError',
        'Callback URL Mismatch',

        // Erreurs de navigation Next.js
        'Cancel rendering route',
        'The operation was aborted',
        'Navigating to current location',
        'Route cancelled',

        // Erreurs React spécifiques
        'ResizeObserver loop limit exceeded',
        'ResizeObserver loop completed with undelivered notifications',
        'Non-Error promise rejection captured',

        // Erreurs Cloudinary
        'Upload failed',
        'Resource not found',
        'Invalid signature',
        'Transformation failed',

        // Erreurs TipTap/Editor
        'ProseMirror',
        'Editor transaction',
        'Schema validation',

        // Erreurs de validation Yup
        'ValidationError',
        'yup validation error',

        // Erreurs CSP
        'Content Security Policy',
        'violated directive',

        // Extensions de navigateur et scripts externes
        'chrome-extension',
        'safari-extension',
        'moz-extension',
        'Script error',
        'Non-Error exception captured',
      ],

      // Ne pas suivre les erreurs pour certaines URL
      denyUrls: [
        // Ressources externes
        /^chrome:\/\//i,
        /^chrome-extension:\/\//i,
        /^moz-extension:\/\//i,
        /^safari-extension:\/\//i,

        // Ressources tierces
        /googletagmanager\.com/i,
        /analytics\.google\.com/i,
        /facebook\.net/i,
        /connect\.facebook\.net/i,
        /graph\.facebook\.com/i,
      ],

      // Configurer le traitement des breadcrumbs
      beforeBreadcrumb(breadcrumb) {
        // Filtrer certains types d'événements de breadcrumb
        if (breadcrumb.category === 'xhr' || breadcrumb.category === 'fetch') {
          // Masquer les URLs sensibles du dashboard admin
          if (
            breadcrumb.data?.url?.includes('/auth') ||
            breadcrumb.data?.url?.includes('/login') ||
            breadcrumb.data?.url?.includes('/register') ||
            breadcrumb.data?.url?.includes('/dashboard/users') ||
            breadcrumb.data?.url?.includes('/dashboard/orders') ||
            breadcrumb.data?.url?.includes('/dashboard/platforms') ||
            breadcrumb.data?.url?.includes('sign-image') ||
            breadcrumb.data?.url?.includes('password') ||
            breadcrumb.data?.url?.includes('token')
          ) {
            breadcrumb.data.url = '[Filtered URL - Admin Dashboard]';
          }

          // Masquer les données sensibles dans les requêtes
          if (breadcrumb.data?.body) {
            try {
              const body =
                typeof breadcrumb.data.body === 'string'
                  ? JSON.parse(breadcrumb.data.body)
                  : breadcrumb.data.body;

              const sensitiveFields = [
                'password',
                'confirmPassword',
                'user_password',
                'platformNumber',
                'platform_number',
                'token',
                'auth',
                'secret',
                'api_key',
                'cloudinary_secret',
                'db_password',
                'email',
                'phone',
                'user_email',
                'user_phone',
              ];

              let hasSensitiveData = false;
              sensitiveFields.forEach((field) => {
                if (body[field]) {
                  hasSensitiveData = true;
                  body[field] = '[Filtered]';
                }
              });

              if (hasSensitiveData) {
                breadcrumb.data.body = JSON.stringify(body);
              }
            } catch (e) {
              // Si parsing échoue, filtrer complètement
              breadcrumb.data.body = '[Filtered Request Body]';
            }
          }
        }

        // Filtrer les logs console sensibles
        if (breadcrumb.category === 'console') {
          const sensitivePatterns = [
            /password/i,
            /token/i,
            /secret/i,
            /api[_-]?key/i,
            /platform[_-]?number/i,
            /db[_-]?password/i,
            /nextauth[_-]?secret/i,
            /cloudinary[_-]?secret/i,
          ];

          if (
            sensitivePatterns.some((pattern) =>
              pattern.test(breadcrumb.message || ''),
            )
          ) {
            breadcrumb.message =
              '[Console log filtered - contains sensitive data]';
          }
        }

        return breadcrumb;
      },

      // Configurer le traitement des événements avant l'envoi
      beforeSend(event) {
        // Ne pas envoyer d'événements pour les pages d'authentification sensibles
        if (
          event.request?.url?.includes('/auth') ||
          event.request?.url?.includes('/login') ||
          event.request?.url?.includes('/register') ||
          event.request?.url?.includes('/dashboard/users') ||
          event.request?.url?.includes('/dashboard/platforms/add') ||
          event.request?.url?.includes('sign-image')
        ) {
          return null;
        }

        // Anonymiser les informations utilisateur
        if (event.user) {
          const anonymizedUser = {};

          // Garder l'ID mais l'anonymiser partiellement
          if (event.user.id) {
            const id = String(event.user.id);
            anonymizedUser.id =
              id.length > 2 ? id[0] + '***' + id.slice(-1) : '[USER_ID]';
          }

          // Anonymiser l'email
          if (event.user.email) {
            const email = event.user.email;
            const atIndex = email.indexOf('@');
            if (atIndex > 0) {
              const domain = email.slice(atIndex);
              anonymizedUser.email = `${email[0]}***${domain}`;
            } else {
              anonymizedUser.email = '[Filtered]';
            }
          }

          // Garder le rôle s'il n'est pas sensible
          if (
            event.user.role &&
            !['admin', 'superadmin'].includes(event.user.role)
          ) {
            anonymizedUser.role = event.user.role;
          } else if (event.user.role) {
            anonymizedUser.role = '[Admin Role]';
          }

          // Supprimer complètement les champs sensibles
          delete event.user.ip_address;
          delete event.user.user_password;
          delete event.user.session_token;
          delete event.user.phone;
          delete event.user.user_phone;

          event.user = anonymizedUser;
        }

        // Anonymiser les données sensibles dans les URL
        if (event.request?.url) {
          try {
            const url = new URL(event.request.url);

            // Paramètres sensibles à masquer
            const sensitiveParams = [
              'token',
              'password',
              'secret',
              'api_key',
              'auth',
              'platformNumber',
              'platform_number',
              'user_password',
              'nextauth_secret',
              'cloudinary_secret',
              'reset_token',
            ];

            let hasFilteredParams = false;
            sensitiveParams.forEach((param) => {
              if (url.searchParams.has(param)) {
                url.searchParams.set(param, '[Filtered]');
                hasFilteredParams = true;
              }
            });

            if (hasFilteredParams) {
              event.request.url = url.toString();
            }
          } catch (e) {
            // Si parsing URL échoue, laisser tel quel
            console.warn('Failed to parse URL for Sentry filtering:', e);
          }
        }

        // Filtrer les données dans les headers de requête
        if (event.request?.headers) {
          const sensitiveHeaders = [
            'authorization',
            'cookie',
            'x-auth-token',
            'x-session-token',
            'nextauth.session-token',
            'x-api-key',
            'cloudinary-auth',
          ];

          Object.keys(event.request.headers).forEach((header) => {
            if (
              sensitiveHeaders.some((sh) => header.toLowerCase().includes(sh))
            ) {
              event.request.headers[header] = '[Filtered]';
            }
          });
        }

        // Filtrer les erreurs contenant des données sensibles dans le message
        if (event.exception?.values) {
          event.exception.values.forEach((exception) => {
            if (exception.value) {
              const sensitivePatterns = [
                /password[=:]\s*[^\s]+/gi,
                /token[=:]\s*[^\s]+/gi,
                /secret[=:]\s*[^\s]+/gi,
                /api[_-]?key[=:]\s*[^\s]+/gi,
                /platform[_-]?number[=:]\s*[^\s]+/gi,
              ];

              sensitivePatterns.forEach((pattern) => {
                exception.value = exception.value.replace(
                  pattern,
                  '[Filtered Sensitive Data]',
                );
              });
            }
          });
        }

        // Ajouter des tags spécifiques au contexte du dashboard
        event.tags = {
          ...event.tags,
          project: 'admin-dashboard',
          stack: 'nextjs-postgres-nextauth',
        };

        // Identifier le type d'erreur par contexte
        if (event.request?.url) {
          if (event.request.url.includes('/api/dashboard/')) {
            event.tags.api_type = 'dashboard_api';

            // Identifier l'entité spécifique
            if (event.request.url.includes('templates'))
              event.tags.entity = 'template';
            else if (event.request.url.includes('applications'))
              event.tags.entity = 'application';
            else if (event.request.url.includes('blog'))
              event.tags.entity = 'blog';
            else if (event.request.url.includes('platforms'))
              event.tags.entity = 'platform';
            else if (event.request.url.includes('orders'))
              event.tags.entity = 'order';
            else if (event.request.url.includes('users'))
              event.tags.entity = 'user';
          } else if (event.request.url.includes('/api/auth/')) {
            event.tags.api_type = 'nextauth';
          } else if (event.request.url.includes('/api/register')) {
            event.tags.api_type = 'registration';
          }
        }

        return event;
      },

      // Intégrations spécifiques pour le dashboard
      integrations: [
        new Sentry.Replay({
          maskAllText: true,
          blockAllMedia: true,
          maskAllInputs: true,
          // Classes spécifiques à masquer dans le dashboard
          blockClass: 'sentry-block',
          maskClass: 'sentry-mask',
          // Masquer les éléments sensibles du dashboard
          blockSelector:
            '.password-input, .platform-number, .sensitive-data, .admin-only',
        }),
      ],
    });
  }
};

/**
 * Capture une exception avec des informations contextuelles pour le dashboard
 * @param {Error} error - L'erreur à capturer
 * @param {Object} context - Contexte supplémentaire sur l'erreur
 */
export const captureException = (error, context = {}) => {
  Sentry.withScope((scope) => {
    // Tags spécifiques au dashboard admin
    const defaultTags = {
      component: 'dashboard',
      project: 'admin-ecommerce',
      ...context.tags,
    };

    Object.entries(defaultTags).forEach(([key, value]) => {
      scope.setTag(key, value);
    });

    // Catégoriser les erreurs par type
    if (error?.message) {
      if (/postgres|pg|database|db|connection/i.test(error.message)) {
        scope.setTag('error_category', 'database');
      } else if (/nextauth|auth|session/i.test(error.message)) {
        scope.setTag('error_category', 'authentication');
      } else if (/cloudinary|upload|image/i.test(error.message)) {
        scope.setTag('error_category', 'media_upload');
      } else if (/validation|yup|schema/i.test(error.message)) {
        scope.setTag('error_category', 'validation');
      } else if (/tiptap|editor/i.test(error.message)) {
        scope.setTag('error_category', 'editor');
      } else if (/rate.?limit/i.test(error.message)) {
        scope.setTag('error_category', 'rate_limiting');
      }
    }

    // Ajouter des données supplémentaires filtrées
    const filteredExtra = {};
    Object.entries(context.extra || {}).forEach(([key, value]) => {
      // Filtrer les données sensibles dans les extras
      const sensitiveKeys = [
        'password',
        'token',
        'secret',
        'api_key',
        'platform_number',
        'user_password',
        'db_password',
        'nextauth_secret',
        'cloudinary_secret',
      ];

      if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk))) {
        filteredExtra[key] = '[Filtered]';
      } else {
        filteredExtra[key] = value;
      }
    });

    Object.entries(filteredExtra).forEach(([key, value]) => {
      scope.setExtra(key, value);
    });

    // Définir le niveau de l'erreur
    if (context.level) {
      scope.setLevel(context.level);
    }

    // Capturer l'exception
    Sentry.captureException(error);
  });
};

/**
 * Capture un message avec des informations contextuelles pour le dashboard
 * @param {string} message - Le message à capturer
 * @param {Object} context - Contexte supplémentaire sur le message
 */
export const captureMessage = (message, context = {}) => {
  Sentry.withScope((scope) => {
    // Tags par défaut pour le dashboard
    const defaultTags = {
      component: 'dashboard',
      project: 'admin-ecommerce',
      ...context.tags,
    };

    Object.entries(defaultTags).forEach(([key, value]) => {
      scope.setTag(key, value);
    });

    // Filtrer le message s'il contient des données sensibles
    let filteredMessage = message;
    const sensitivePatterns = [
      /password[=:]\s*[^\s]+/gi,
      /token[=:]\s*[^\s]+/gi,
      /secret[=:]\s*[^\s]+/gi,
      /platform[_-]?number[=:]\s*[^\s]+/gi,
    ];

    sensitivePatterns.forEach((pattern) => {
      filteredMessage = filteredMessage.replace(
        pattern,
        '[Filtered Sensitive Data]',
      );
    });

    // Ajouter des données supplémentaires filtrées
    Object.entries(context.extra || {}).forEach(([key, value]) => {
      scope.setExtra(key, value);
    });

    // Définir le niveau du message
    if (context.level) {
      scope.setLevel(context.level);
    }

    // Capturer le message filtré
    Sentry.captureMessage(filteredMessage);
  });
};

/**
 * Enregistre l'utilisateur actuel dans Sentry pour le suivi des erreurs
 * Optimisé pour les utilisateurs du dashboard admin
 * @param {Object} user - Informations de l'utilisateur à enregistrer
 */
export const setUser = (user) => {
  if (!user) {
    Sentry.setUser(null);
    return;
  }

  // Anonymiser complètement les données utilisateur pour la sécurité du dashboard
  const anonymizedUser = {
    id: user.id || user._id || user.user_id || 'unknown',
    // Anonymiser l'email avec hash
    email: user.email ? `${hashCode(user.email)}@admin.dashboard` : undefined,
    // Anonymiser le rôle si c'est un admin
    role: ['admin', 'superadmin'].includes(user.role)
      ? 'admin_user'
      : user.role || 'user',
    // Ajouter des métadonnées non sensibles
    dashboard_user: true,
    login_method: user.provider || 'credentials',
  };

  // Ne jamais envoyer d'informations personnelles identifiables
  Sentry.setUser(anonymizedUser);
};

/**
 * Fonction auxiliaire pour créer un hachage simple d'une chaîne
 * @param {string} str - La chaîne à hacher
 * @returns {string} - Le hachage en hexadécimal
 */
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Conversion en 32bit integer
  }
  return Math.abs(hash).toString(16);
}

/**
 * Capture les erreurs de base de données PostgreSQL avec contexte spécifique
 * @param {Error} error - L'erreur PostgreSQL
 * @param {Object} context - Contexte de la requête DB
 */
export const captureDatabaseError = (error, context = {}) => {
  const dbContext = {
    tags: {
      error_category: 'database',
      database_type: 'postgresql',
      ...context.tags,
    },
    extra: {
      postgres_code: error.code,
      table: context.table || 'unknown',
      operation: context.operation || 'unknown',
      query_type: context.queryType || 'unknown',
      ...context.extra,
    },
    level: 'error',
  };

  // Filtrer les informations sensibles de la DB
  if (dbContext.extra.query) {
    // Masquer les valeurs dans les requêtes SQL
    dbContext.extra.query = dbContext.extra.query.replace(
      /(password|token|secret|platform_number)\s*=\s*'[^']*'/gi,
      "$1 = '[Filtered]'",
    );
  }

  captureException(error, dbContext);
};

/**
 * Capture les erreurs d'authentification NextAuth avec contexte spécifique
 * @param {Error} error - L'erreur d'authentification
 * @param {Object} context - Contexte de l'authentification
 */
export const captureAuthError = (error, context = {}) => {
  const authContext = {
    tags: {
      error_category: 'authentication',
      auth_provider: 'nextauth',
      ...context.tags,
    },
    extra: {
      auth_method: context.method || 'unknown',
      provider: context.provider || 'credentials',
      ...context.extra,
    },
    level: 'warning',
  };

  captureException(error, authContext);
};

/**
 * Capture les erreurs de validation avec contexte spécifique
 * @param {Error} error - L'erreur de validation
 * @param {Object} context - Contexte de la validation
 */
export const captureValidationError = (error, context = {}) => {
  const validationContext = {
    tags: {
      error_category: 'validation',
      validation_library: 'yup',
      ...context.tags,
    },
    extra: {
      field: context.field || 'unknown',
      form: context.form || 'unknown',
      validation_type: context.validationType || 'unknown',
      ...context.extra,
    },
    level: 'info',
  };

  captureException(error, validationContext);
};
