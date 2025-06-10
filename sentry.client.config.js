// This file configures the initialization of Sentry on the browser side.
// The config you add here will be used whenever a user loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: process.env.NODE_ENV === 'development',

  // Replay configuration for user session recording
  replaysOnErrorSampleRate: 1.0,
  replaysSessionSampleRate: process.env.NODE_ENV === 'production' ? 0.01 : 0.1,

  // You can remove this option if you're not planning to use the Sentry Session Replay feature:
  integrations: [
    Sentry.replayIntegration({
      // Additional configuration for session replay
      maskAllText: false,
      blockAllMedia: false,
    }),
    Sentry.browserTracingIntegration(),
  ],

  // Environment configuration
  environment: process.env.NODE_ENV,

  // Additional configuration for e-commerce
  beforeSend(event) {
    // Filter out sensitive information for e-commerce
    if (event.request?.data) {
      // Remove sensitive payment information
      const sensitiveFields = [
        'password',
        'credit_card',
        'cvv',
        'ssn',
        'token',
      ];
      sensitiveFields.forEach((field) => {
        if (event.request.data[field]) {
          event.request.data[field] = '[Filtered]';
        }
      });
    }
    return event;
  },

  // Custom tags for e-commerce context
  initialScope: {
    tags: {
      component: 'client',
      project: 'ecommerce',
    },
  },
});
