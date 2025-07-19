// instrumentation-client.js
// Configuration Sentry pour le navigateur (client-side)
// Version optimisée pour Next.js 15

import * as Sentry from '@sentry/nextjs';

// Validation du DSN côté client
function isValidDSN(dsn) {
  if (!dsn) return false;
  return /^https:\/\/[^@]+@[^/]+\/\d+$/.test(dsn);
}

// Détection de données sensibles côté client
function containsSensitiveDataClient(str) {
  if (!str || typeof str !== 'string') return false;

  const patterns = [
    /password/i,
    /token/i,
    /secret/i,
    /api[_-]?key/i,
    /platform[_-]?number/i,
    /credit[_-]?card/i,
    /cvv/i,
    /ssn/i,
  ];

  return patterns.some((pattern) => pattern.test(str));
}

// Variables d'environnement client
const sentryDSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
const environment = process.env.NODE_ENV || 'development';
const isProduction = environment === 'production';

// Initialisation Sentry côté client
if (sentryDSN && isValidDSN(sentryDSN)) {
  Sentry.init({
    dsn: sentryDSN,
    environment,
    release:
      process.env.SENTRY_RELEASE ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      '1.0.0',

    // Configuration client
    debug: !isProduction,
    enabled: true,

    // Performance monitoring client
    tracesSampleRate: isProduction ? 0.1 : 1.0,

    // Session Replay configuration
    replaysOnErrorSampleRate: 1.0,
    replaysSessionSampleRate: isProduction ? 0.01 : 0.1,

    // Intégrations client
    integrations: [
      Sentry.replayIntegration({
        // Configuration Session Replay sécurisée
        maskAllText: true,
        blockAllMedia: true,
        maskAllInputs: true,

        // Classes spécifiques à masquer dans le dashboard
        blockClass: 'sentry-block',
        maskClass: 'sentry-mask',

        // Sélecteurs spécifiques pour masquer les éléments sensibles
        blockSelector: [
          '.password-input',
          '.platform-number',
          '.sensitive-data',
          '.admin-only',
          '[data-sensitive]',
          '.payment-info',
          '.user-credentials',
        ].join(', '),

        // Masquer les attributs sensibles
        maskTextSelector: [
          '[data-mask]',
          '.user-email',
          '.user-phone',
          '.financial-data',
        ].join(', '),
      }),

      Sentry.browserTracingIntegration({
        // Configuration du tracing browser
        tracePropagationTargets: ['localhost', /^https:\/\/yoursite\.com\/api/],
      }),
    ],

    // Erreurs à ignorer côté client
    ignoreErrors: [
      // Erreurs réseau client
      'Network request failed',
      'Failed to fetch',
      'NetworkError',
      'TypeError: Failed to fetch',
      'AbortError',

      // Erreurs browser spécifiques
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      'Non-Error promise rejection captured',
      'Script error',
      'Non-Error exception captured',

      // Extensions browser
      'chrome-extension',
      'safari-extension',
      'moz-extension',

      // Erreurs React development
      'Warning: ',
      'You are importing createRoot from "react-dom"',

      // Erreurs de navigation
      'Navigation cancelled',
      'Route cancelled',
      'The operation was aborted',

      // Erreurs d'authentification côté client
      'NextAuthError',
      'OAuthCallbackError',
      'SessionProviderError',
    ],

    // URLs à ne pas tracer
    denyUrls: [
      // Extensions navigateur
      /^chrome:\/\//i,
      /^chrome-extension:\/\//i,
      /^moz-extension:\/\//i,
      /^safari-extension:\/\//i,

      // Scripts tiers
      /googletagmanager\.com/i,
      /analytics\.google\.com/i,
      /facebook\.net/i,
      /connect\.facebook\.net/i,
    ],

    // Configuration des breadcrumbs côté client
    beforeBreadcrumb(breadcrumb) {
      // Filtrer les requêtes sensibles
      if (['xhr', 'fetch'].includes(breadcrumb.category) && breadcrumb.data) {
        // Masquer les URLs sensibles
        if (breadcrumb.data.url) {
          const url = breadcrumb.data.url;

          // URLs sensibles spécifiques au dashboard
          if (
            url.includes('/auth') ||
            url.includes('/login') ||
            url.includes('/register') ||
            url.includes('/dashboard/users') ||
            url.includes('/dashboard/platforms') ||
            url.includes('sign-image') ||
            url.includes('password') ||
            url.includes('token')
          ) {
            breadcrumb.data.url = '[FILTERED_CLIENT_URL]';
          }
        }

        // Masquer les données de requête sensibles
        if (breadcrumb.data.body) {
          try {
            const body =
              typeof breadcrumb.data.body === 'string'
                ? JSON.parse(breadcrumb.data.body)
                : breadcrumb.data.body;

            const sensitiveFields = [
              'password',
              'confirmPassword',
              'token',
              'auth',
              'secret',
              'api_key',
              'platform_number',
              'credit_card',
              'cvv',
              'email',
              'phone',
            ];

            let hasSensitiveData = false;
            sensitiveFields.forEach((field) => {
              if (body[field]) {
                hasSensitiveData = true;
                body[field] = '[FILTERED_CLIENT]';
              }
            });

            if (hasSensitiveData) {
              breadcrumb.data.body = JSON.stringify(body);
            }
          } catch (e) {
            if (containsSensitiveDataClient(breadcrumb.data.body)) {
              breadcrumb.data.body = '[FILTERED_CLIENT_BODY]';
            }
          }
        }
      }

      // Filtrer les logs console côté client
      if (breadcrumb.category === 'console' && breadcrumb.message) {
        if (containsSensitiveDataClient(breadcrumb.message)) {
          breadcrumb.message = '[FILTERED_CLIENT_LOG]';
        }
      }

      // Filtrer les clics sur éléments sensibles
      if (breadcrumb.category === 'ui.click' && breadcrumb.message) {
        if (
          breadcrumb.message.includes('password') ||
          breadcrumb.message.includes('sensitive') ||
          breadcrumb.message.includes('admin-only')
        ) {
          breadcrumb.message = '[FILTERED_CLIENT_CLICK]';
        }
      }

      return breadcrumb;
    },

    // Configuration des événements avant envoi (client)
    beforeSend(event, hint) {
      // Ne pas envoyer d'événements depuis certaines pages sensibles
      if (
        window.location.pathname.includes('/auth') ||
        window.location.pathname.includes('/login') ||
        window.location.pathname.includes('/register') ||
        window.location.pathname.includes('/dashboard/users') ||
        window.location.pathname.includes('/dashboard/platforms/add')
      ) {
        return null;
      }

      // Tags côté client
      event.tags = event.tags || {};
      event.tags.runtime = 'browser';
      event.tags.component = 'client';

      // Catégorisation des erreurs côté client
      if (hint && hint.originalException) {
        const error = hint.originalException;
        const message = error.message || '';

        if (/network|fetch|request/i.test(message)) {
          event.tags.error_category = 'network';
        } else if (/react|component|render/i.test(message)) {
          event.tags.error_category = 'react';
        } else if (/auth|permission|token/i.test(message)) {
          event.tags.error_category = 'authentication';
        } else if (/validation|invalid/i.test(message)) {
          event.tags.error_category = 'validation';
        } else {
          event.tags.error_category = 'client_runtime';
        }
      }

      // Anonymiser les données utilisateur côté client
      if (event.user) {
        const cleanUser = { ...event.user };

        // Supprimer les données sensibles
        delete cleanUser.ip_address;
        delete cleanUser.session_token;
        delete cleanUser.password;

        // Anonymiser l'email
        if (cleanUser.email) {
          const email = cleanUser.email;
          const atIndex = email.indexOf('@');
          if (atIndex > 0) {
            cleanUser.email = `${email[0]}***${email.slice(atIndex)}`;
          }
        }

        // Anonymiser l'ID
        if (cleanUser.id) {
          const id = String(cleanUser.id);
          cleanUser.id =
            id.length > 2 ? `${id[0]}***${id.slice(-1)}` : '[USER_ID]';
        }

        event.user = cleanUser;
      }

      // Anonymiser les URLs côté client
      if (event.request && event.request.url) {
        try {
          const url = new URL(event.request.url);
          const sensitiveParams = ['token', 'password', 'secret', 'api_key'];

          sensitiveParams.forEach((param) => {
            if (url.searchParams.has(param)) {
              url.searchParams.set(param, '[FILTERED_CLIENT]');
            }
          });

          event.request.url = url.toString();
        } catch (e) {
          // Garder l'URL originale si le parsing échoue
        }
      }

      // Filtrer les headers côté client
      if (event.request && event.request.headers) {
        const sensitiveHeaders = ['cookie', 'authorization', 'x-auth-token'];
        const cleanHeaders = { ...event.request.headers };

        sensitiveHeaders.forEach((header) => {
          Object.keys(cleanHeaders).forEach((key) => {
            if (key.toLowerCase().includes(header)) {
              cleanHeaders[key] = '[FILTERED_CLIENT]';
            }
          });
        });

        event.request.headers = cleanHeaders;
      }

      // Filtrer les messages d'erreur sensibles
      if (event.message && containsSensitiveDataClient(event.message)) {
        event.message = `[FILTERED_CLIENT_MESSAGE] ${event.message.substring(0, 50)}...`;
      }

      return event;
    },

    // Scope initial côté client
    initialScope: {
      tags: {
        component: 'client',
        project: 'ecommerce-dashboard',
        runtime: 'browser',
      },
    },
  });

  console.log('🌐 Sentry client configuration initialized successfully');
} else {
  console.warn('⚠️ Sentry client configuration: Invalid or missing DSN');
}

// Export pour le tracing des transitions de route (Next.js 15)
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
