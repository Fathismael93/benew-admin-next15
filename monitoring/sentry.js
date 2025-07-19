// monitoring/sentry.js
// Fonctions Sentry adaptées pour les Server Components et Next.js 15
// Utilise directement les imports Sentry plutôt que la configuration centralisée

import * as Sentry from '@sentry/nextjs';
import { categorizeError } from '@/utils/helpers';

/**
 * Capture une exception avec des informations contextuelles pour les Server Components
 * @param {Error} error - L'erreur à capturer
 * @param {Object} context - Contexte supplémentaire sur l'erreur
 */
export const captureException = (error, context = {}) => {
  Sentry.withScope((scope) => {
    // Tags spécifiques au Server Component
    const defaultTags = {
      component: 'server_component',
      project: 'admin-ecommerce',
      runtime: 'nodejs',
      execution_context: 'server_component',
      ...context.tags,
    };

    Object.entries(defaultTags).forEach(([key, value]) => {
      scope.setTag(key, value);
    });

    // Catégoriser les erreurs par type (utilise le helper safe)
    if (error?.message) {
      scope.setTag('error_category', categorizeError(error));

      // Catégories spécifiques aux Server Components
      if (
        /server.?component|getServerSession|await.*params/i.test(error.message)
      ) {
        scope.setTag('error_category', 'server_component');
      } else if (/notFound|redirect|revalidate/i.test(error.message)) {
        scope.setTag('error_category', 'navigation');
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
        'session_token',
        'auth_header',
      ];

      if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk))) {
        filteredExtra[key] = '[FILTERED_SERVER_COMPONENT]';
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
 * Capture un message avec des informations contextuelles pour les Server Components
 * @param {string} message - Le message à capturer
 * @param {Object} context - Contexte supplémentaire sur le message
 */
export const captureMessage = (message, context = {}) => {
  Sentry.withScope((scope) => {
    // Tags par défaut pour les Server Components
    const defaultTags = {
      component: 'server_component',
      project: 'admin-ecommerce',
      runtime: 'nodejs',
      execution_context: 'server_component',
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
      /api[_-]?key[=:]\s*[^\s]+/gi,
    ];

    sensitivePatterns.forEach((pattern) => {
      filteredMessage = filteredMessage.replace(
        pattern,
        '[FILTERED_SERVER_COMPONENT_DATA]',
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
 * Capture les erreurs de base de données PostgreSQL avec contexte spécifique aux Server Components
 * @param {Error} error - L'erreur PostgreSQL
 * @param {Object} context - Contexte de la requête DB
 */
export const captureDatabaseError = (error, context = {}) => {
  const dbContext = {
    tags: {
      error_category: 'database',
      database_type: 'postgresql',
      component: 'server_component',
      runtime: 'nodejs',
      execution_context: 'server_component',
      ...context.tags,
    },
    extra: {
      postgres_code: error.code,
      table: context.table || 'unknown',
      operation: context.operation || 'unknown',
      query_type: context.queryType || 'unknown',
      connection_pool: 'pg',
      ...context.extra,
    },
    level: 'error',
  };

  // Filtrer les informations sensibles de la DB dans les Server Components
  if (dbContext.extra.query) {
    // Masquer les valeurs dans les requêtes SQL
    dbContext.extra.query = dbContext.extra.query.replace(
      /(password|token|secret|platform_number)\s*=\s*'[^']*'/gi,
      "$1 = '[FILTERED_SERVER_COMPONENT]'",
    );
  }

  if (dbContext.extra.connectionString) {
    dbContext.extra.connectionString = '[FILTERED_SERVER_COMPONENT]';
  }

  captureException(error, dbContext);
};

/**
 * Capture les erreurs d'authentification NextAuth avec contexte spécifique aux Server Components
 * @param {Error} error - L'erreur d'authentification
 * @param {Object} context - Contexte de l'authentification
 */
export const captureAuthError = (error, context = {}) => {
  const authContext = {
    tags: {
      error_category: 'authentication',
      auth_provider: 'nextauth',
      component: 'server_component',
      runtime: 'nodejs',
      execution_context: 'server_component',
      ...context.tags,
    },
    extra: {
      auth_method: context.method || 'unknown',
      provider: context.provider || 'credentials',
      auth_flow: 'server_component',
      ...context.extra,
    },
    level: 'warning',
  };

  // Filtrer les données d'authentification sensibles
  if (authContext.extra.session) {
    authContext.extra.session = '[FILTERED_SERVER_COMPONENT_SESSION]';
  }

  if (authContext.extra.token) {
    authContext.extra.token = '[FILTERED_SERVER_COMPONENT_TOKEN]';
  }

  captureException(error, authContext);
};

/**
 * Capture les erreurs de validation avec contexte spécifique aux Server Components
 * @param {Error} error - L'erreur de validation
 * @param {Object} context - Contexte de la validation
 */
export const captureValidationError = (error, context = {}) => {
  const validationContext = {
    tags: {
      error_category: 'validation',
      validation_library: 'yup',
      component: 'server_component',
      runtime: 'nodejs',
      execution_context: 'server_component',
      ...context.tags,
    },
    extra: {
      field: context.field || 'unknown',
      form: context.form || 'unknown',
      validation_type: context.validationType || 'unknown',
      validation_context: 'server_component',
      ...context.extra,
    },
    level: 'info',
  };

  captureException(error, validationContext);
};

/**
 * Capture les erreurs spécifiques aux Server Components Next.js 15
 * @param {Error} error - L'erreur du Server Component
 * @param {Object} context - Contexte du Server Component
 */
export const captureServerComponentError = (error, context = {}) => {
  const serverComponentContext = {
    tags: {
      error_category: 'server_component',
      framework: 'nextjs',
      version: '15',
      component: 'server_component',
      runtime: 'nodejs',
      execution_context: 'server_component',
      ...context.tags,
    },
    extra: {
      component_name: context.componentName || 'unknown',
      route: context.route || 'unknown',
      params: context.params ? '[FILTERED_PARAMS]' : undefined,
      searchParams: context.searchParams
        ? '[FILTERED_SEARCH_PARAMS]'
        : undefined,
      ...context.extra,
    },
    level: 'error',
  };

  captureException(error, serverComponentContext);
};

/**
 * Capture les erreurs de cache spécifiques aux Server Components
 * @param {Error} error - L'erreur de cache
 * @param {Object} context - Contexte du cache
 */
export const captureCacheError = (error, context = {}) => {
  const cacheContext = {
    tags: {
      error_category: 'cache',
      cache_type: context.cacheType || 'unknown',
      component: 'server_component',
      runtime: 'nodejs',
      execution_context: 'server_component',
      ...context.tags,
    },
    extra: {
      cache_key: context.cacheKey || 'unknown',
      operation: context.operation || 'unknown',
      cache_provider: 'lru-cache',
      ...context.extra,
    },
    level: 'warning',
  };

  captureException(error, cacheContext);
};

/**
 * Enregistre l'utilisateur actuel dans Sentry pour les Server Components
 * Version adaptée pour l'environnement serveur
 * @param {Object} user - Informations de l'utilisateur à enregistrer
 */
export const setUser = (user) => {
  if (!user) {
    Sentry.setUser(null);
    return;
  }

  // Anonymiser complètement les données utilisateur pour la sécurité des Server Components
  const anonymizedUser = {
    id: user.id ? `sc_${hashCode(String(user.id))}` : 'unknown',
    // Anonymiser l'email avec hash pour les Server Components
    email: user.email ? `${hashCode(user.email)}@server.component` : undefined,
    // Anonymiser le rôle si c'est un admin
    role: ['admin', 'superadmin'].includes(user.role)
      ? 'admin_user'
      : user.role || 'user',
    // Métadonnées spécifiques aux Server Components
    server_component_user: true,
    login_method: user.provider || 'credentials',
    execution_context: 'server_component',
  };

  // Ne jamais envoyer d'informations personnelles identifiables depuis les Server Components
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
 * Capture les performances des Server Components
 * @param {string} componentName - Nom du Server Component
 * @param {number} startTime - Temps de début
 * @param {Object} context - Contexte supplémentaire
 */
export const captureServerComponentPerformance = (
  componentName,
  startTime,
  context = {},
) => {
  const duration = Date.now() - startTime;

  // Seulement capturer si la performance est dégradée
  if (duration > 1000) {
    // Plus de 1 seconde
    Sentry.addBreadcrumb({
      category: 'performance',
      message: `Slow Server Component: ${componentName}`,
      level: 'warning',
      data: {
        component: componentName,
        duration_ms: duration,
        execution_context: 'server_component',
        ...context,
      },
    });
  }
};

/**
 * Utilitaire pour wrapper les Server Components avec monitoring automatique
 * @param {Function} component - Le Server Component à wrapper
 * @param {string} componentName - Nom du composant pour le monitoring
 * @returns {Function} - Server Component wrappé
 */
export const withServerComponentMonitoring = (component, componentName) => {
  return async (props) => {
    const startTime = Date.now();

    try {
      const result = await component(props);

      // Capturer les performances
      captureServerComponentPerformance(componentName, startTime, {
        props_keys: Object.keys(props || {}),
      });

      return result;
    } catch (error) {
      // Capturer l'erreur avec contexte du Server Component
      captureServerComponentError(error, {
        componentName,
        props: props ? '[FILTERED_PROPS]' : undefined,
        duration_ms: Date.now() - startTime,
      });

      // Re-throw l'erreur pour que Next.js puisse la gérer
      throw error;
    }
  };
};
