// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
// instrumentation.js
import * as Sentry from '@sentry/nextjs';
import { EventEmitter } from 'events';
import {
  containsSensitiveData,
  categorizeError,
  anonymizeUserData,
  anonymizeUrl,
  anonymizeHeaders,
  filterRequestBody,
} from './utils/helpers.js';

// Augmenter la limite d'écouteurs d'événements pour éviter l'avertissement
if (typeof EventEmitter !== 'undefined') {
  EventEmitter.defaultMaxListeners = 25;
}

function isValidDSN(dsn) {
  if (!dsn) return false;
  return /^https:\/\/[^@]+@[^/]+\/\d+$/.test(dsn);
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
        // tracesSampleRate: isProduction ? 0.1 : 1.0,
        // profilesSampleRate: isProduction ? 0.1 : 1.0,

        // Intégrations spécifiques
        // integrations: [
        //   new Sentry.Replay({
        //     maskAllText: true,
        //     blockAllMedia: true,
        //     maskAllInputs: true,
        //     blockClass: 'sentry-block',
        //     maskClass: 'sentry-mask',
        //   }),
        // ],

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
            // Filtrer les URLs sensibles - utilise la fonction centralisée
            if (breadcrumb.data.url) {
              breadcrumb.data.url = anonymizeUrl(breadcrumb.data.url);
            }

            // Filtrer les corps de requête - utilise la fonction centralisée
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

            // Filtrer les headers de response - utilise la fonction centralisée
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

          // Ajouter la catégorie d'erreur spécifique à votre application - utilise la fonction centralisée
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

          // Anonymiser les headers - utilise la fonction centralisée
          if (event.request && event.request.headers) {
            event.request.headers = anonymizeHeaders(event.request.headers);
          }

          // Anonymiser les cookies
          if (event.request && event.request.cookies) {
            event.request.cookies = '[FILTERED]';
          }

          // Anonymiser les données utilisateurs - utilise la fonction centralisée
          if (event.user) {
            event.user = anonymizeUserData(event.user);
          }

          // Anonymiser les URL - utilise la fonction centralisée
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
    // Contexte enrichi spécifique à votre application dashboard - utilise les fonctions centralisées
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

    // Informations utilisateur anonymisées - utilise la fonction centralisée
    if (request.auth && request.auth.userId) {
      const userId = String(request.auth.userId);
      Sentry.setUser(
        anonymizeUserData({
          id: userId,
          role: request.auth.role || 'user',
          type: 'dashboard_user',
        }),
      );
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
