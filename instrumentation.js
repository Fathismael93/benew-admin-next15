// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: process.env.NODE_ENV === 'development',

  // Environment configuration
  environment: process.env.NODE_ENV,

  // Server-side specific configuration
  integrations: [
    Sentry.httpIntegration(),
    Sentry.prismaIntegration(), // Si vous utilisez Prisma
  ],

  // Custom error filtering for server-side
  beforeSend(event) {
    // Filter out common non-critical errors
    if (event.exception?.values?.[0]?.type === 'AbortError') {
      return null;
    }

    // Filter sensitive server information
    if (event.request?.data) {
      const sensitiveFields = ['password', 'token', 'apiKey', 'secret'];
      sensitiveFields.forEach((field) => {
        if (event.request.data[field]) {
          event.request.data[field] = '[Filtered]';
        }
      });
    }

    return event;
  },

  // Custom tags for server context
  initialScope: {
    tags: {
      component: 'server',
      project: 'ecommerce',
    },
  },
});
