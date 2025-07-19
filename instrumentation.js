// instrumentation.js
// Orchestration pure pour Next.js 15 + Sentry
// Ce fichier ne contient que la logique de routage vers les bonnes configurations

/**
 * Fonction d'enregistrement principale pour l'instrumentation
 * Route vers la bonne configuration selon l'environnement d'exécution
 */
export async function register() {
  try {
    // Configuration pour l'environnement serveur Node.js
    if (process.env.NEXT_RUNTIME === 'nodejs') {
      console.log('🚀 Initializing Sentry for Node.js runtime...');
      await import('./sentry.server.config');
    }

    // Configuration pour l'environnement Edge Runtime
    if (process.env.NEXT_RUNTIME === 'edge') {
      console.log('⚡ Initializing Sentry for Edge runtime...');
      await import('./sentry.edge.config');
    }

    console.log('✅ Sentry instrumentation registered successfully');
  } catch (error) {
    console.error('❌ Failed to register Sentry instrumentation:', error);
  }
}

/**
 * Hook pour capturer les erreurs de requête (Next.js 15)
 * Utilise l'import conditionnel pour éviter les problèmes de runtime
 */
export async function onRequestError(err, request, context) {
  try {
    // Import conditionnel basé sur l'environnement
    if (process.env.NEXT_RUNTIME === 'nodejs') {
      const { captureRequestError } = await import('@sentry/nextjs');
      return captureRequestError(err, request, context);
    }

    if (process.env.NEXT_RUNTIME === 'edge') {
      // Pour l'edge runtime, utiliser une approche simplifiée
      const Sentry = await import('@sentry/nextjs');
      Sentry.captureException(err, {
        tags: {
          runtime: 'edge',
          route: request.url,
          method: request.method,
        },
        extra: {
          context,
          timestamp: new Date().toISOString(),
        },
      });
    }
  } catch (error) {
    console.error('❌ Error in onRequestError hook:', error);
  }
}
