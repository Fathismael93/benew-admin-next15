// sentry.server.config.js
// Configuration Sentry pour l'environnement serveur Node.js

import * as Sentry from '@sentry/nextjs';
import {
  categorizeError,
  anonymizeUserData,
  anonymizeUrl,
  anonymizeHeaders,
  containsSensitiveData,
} from './utils/helpers.js';

// Validation du DSN
function isValidDSN(dsn) {
  if (!dsn) return false;
  return /^https:\/\/[^@]+@[^/]+\/\d+$/.test(dsn);
}

// Variables d'environnement
const sentryDSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
const environment = process.env.NODE_ENV || 'development';
const isProduction = environment === 'production';

// Initialisation Sentry pour le serveur Node.js
if (sentryDSN && isValidDSN(sentryDSN)) {
  Sentry.init({
    dsn: sentryDSN,
    environment,
    release:
      process.env.SENTRY_RELEASE ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      '1.0.0',

    // Configuration serveur
    debug: !isProduction,
    enabled: true, // Toujours activé côté serveur pour le monitoring

    // Performance monitoring
    tracesSampleRate: isProduction ? 0.1 : 1.0,
    profilesSampleRate: isProduction ? 0.05 : 0.1,

    // Erreurs à ignorer spécifiques au serveur
    ignoreErrors: [
      // Erreurs réseau serveur
      'ECONNREFUSED',
      'ECONNRESET',
      'ETIMEDOUT',
      'socket hang up',
      'connect ETIMEDOUT',

      // Erreurs PostgreSQL communes (non critiques)
      'Connection terminated',
      'Client has encountered a connection error',
      'Connection timeout',
      'connection not available',

      // Erreurs Next.js serveur
      'NEXT_REDIRECT',
      'NEXT_NOT_FOUND',
      'Route cancelled',

      // Erreurs d'authentification non critiques
      'NextAuthError',
      'OAuthCallbackError',
      'SessionProviderError',

      // Erreurs de validation business
      'ValidationError',
      'yup validation error',

      // Rate limiting (erreurs normales)
      'Rate limit exceeded',
      'Too many requests',
    ],

    // Configuration des breadcrumbs côté serveur
    beforeBreadcrumb(breadcrumb) {
      // Filtrer les breadcrumbs HTTP sensibles
      if (
        ['xhr', 'fetch', 'http'].includes(breadcrumb.category) &&
        breadcrumb.data
      ) {
        // Anonymiser les URLs sensibles
        if (breadcrumb.data.url) {
          breadcrumb.data.url = anonymizeUrl(breadcrumb.data.url);
        }

        // Filtrer les données de requête sensibles
        if (
          breadcrumb.data.body &&
          containsSensitiveData(breadcrumb.data.body)
        ) {
          breadcrumb.data.body = '[FILTERED_SERVER_REQUEST]';
        }

        // Anonymiser les headers de réponse
        if (breadcrumb.data.response_headers) {
          breadcrumb.data.response_headers = anonymizeHeaders(
            breadcrumb.data.response_headers,
          );
        }
      }

      // Filtrer les logs console côté serveur
      if (breadcrumb.category === 'console' && breadcrumb.message) {
        if (containsSensitiveData(breadcrumb.message)) {
          breadcrumb.message = '[FILTERED_SERVER_LOG]';
        }
      }

      return breadcrumb;
    },

    // Configuration des événements avant envoi (serveur)
    beforeSend(event, hint) {
      const error = hint && hint.originalException;

      // Catégorisation des erreurs serveur
      if (error) {
        event.tags = event.tags || {};
        event.tags.error_category = categorizeError(error);
        event.tags.runtime = 'nodejs';
        event.tags.component = 'server';

        // Tags spécifiques au contexte serveur
        if (event.request && event.request.url) {
          const url = event.request.url;

          // Identifier le type d'API
          if (url.includes('/api/dashboard/')) {
            event.tags.api_type = 'dashboard_api';

            // Identifier l'entité spécifique
            if (url.includes('/templates/')) event.tags.entity = 'template';
            else if (url.includes('/applications/'))
              event.tags.entity = 'application';
            else if (url.includes('/blog/')) event.tags.entity = 'blog';
            else if (url.includes('/platforms/'))
              event.tags.entity = 'platform';
            else if (url.includes('/orders/')) event.tags.entity = 'order';
            else if (url.includes('/users/')) event.tags.entity = 'user';
          } else if (url.includes('/api/auth/')) {
            event.tags.api_type = 'nextauth';
          } else if (url.includes('/api/register')) {
            event.tags.api_type = 'registration';
          }
        }
      }

      // Anonymiser les headers côté serveur
      if (event.request && event.request.headers) {
        event.request.headers = anonymizeHeaders(event.request.headers);
      }

      // Anonymiser les cookies
      if (event.request && event.request.cookies) {
        event.request.cookies = '[FILTERED_SERVER]';
      }

      // Anonymiser les données utilisateur côté serveur
      if (event.user) {
        event.user = anonymizeUserData(event.user);
      }

      // Anonymiser les URLs côté serveur
      if (event.request && event.request.url) {
        event.request.url = anonymizeUrl(event.request.url);
      }

      // Filtrer les messages d'erreur sensibles côté serveur
      if (event.message && containsSensitiveData(event.message)) {
        event.message = `[FILTERED_SERVER_MESSAGE] ${event.message.substring(0, 50)}...`;
      }

      // Filtrer les variables dans les frames de stack côté serveur
      if (event.exception && event.exception.values) {
        event.exception.values.forEach((exceptionValue) => {
          if (exceptionValue.stacktrace && exceptionValue.stacktrace.frames) {
            exceptionValue.stacktrace.frames.forEach((frame) => {
              if (frame.vars) {
                Object.keys(frame.vars).forEach((key) => {
                  const value = String(frame.vars[key] || '');
                  if (
                    containsSensitiveData(key) ||
                    containsSensitiveData(value)
                  ) {
                    frame.vars[key] = '[FILTERED_SERVER]';
                  }
                });
              }

              // Nettoyer les chemins de fichiers
              if (frame.filename && frame.filename.includes('node_modules')) {
                frame.filename = frame.filename.replace(
                  /.*node_modules/,
                  '[...]/node_modules',
                );
              }
            });
          }
        });
      }

      // Filtrer les contextes côté serveur
      if (event.contexts) {
        Object.keys(event.contexts).forEach((contextKey) => {
          const context = event.contexts[contextKey];
          if (typeof context === 'object' && context !== null) {
            Object.keys(context).forEach((key) => {
              const value = String(context[key] || '');
              if (containsSensitiveData(key) || containsSensitiveData(value)) {
                context[key] = '[FILTERED_SERVER]';
              }
            });
          }
        });
      }

      return event;
    },

    // Intégrations spécifiques au serveur
    integrations: [
      // Pas de Replay côté serveur
      // Seulement les intégrations serveur nécessaires
    ],
  });

  console.log('✅ Sentry server configuration initialized successfully');
} else {
  console.warn('⚠️ Sentry server configuration: Invalid or missing DSN');
}
