/**
 * Configuration et utilitaires pour la gestion du cache utilisant la bibliothèque lru-cache
 * Optimisé pour dashboard d'administration e-commerce avec Next.js 15, NextAuth, PostgreSQL et Cloudinary
 */

import { LRUCache } from 'lru-cache';
import { compress, decompress } from 'lz-string';
import { captureException } from '@/monitoring/sentry';
import { memoizeWithTTL } from '@/utils/performance';

// Configuration du cache pour les différentes entités du dashboard admin
export const CACHE_CONFIGS = {
  // Configuration pour les utilisateurs authentifiés (3 minutes - sécurité maximale)
  authUsers: {
    maxAge: 3 * 60, // 3 minutes pour données auth sensibles
    staleWhileRevalidate: 0, // Pas de revalidation en arrière-plan pour sécurité
    immutable: false, // Non immutable car sessions peuvent changer
    mustRevalidate: true, // Doit revalider pour sécurité NextAuth
  },

  // Configuration pour les sessions NextAuth (2 minutes)
  authSessions: {
    maxAge: 2 * 60, // 2 minutes pour sessions
    staleWhileRevalidate: 30, // 30 secondes de revalidation
    immutable: false,
    mustRevalidate: true,
    noStore: false, // Permet le cache mais avec revalidation fréquente
  },

  // Durée de cache pour les articles de blog (5 minutes)
  blogArticles: {
    maxAge: 5 * 60 * 60, // 5 heures (contenu relativement stable)
    staleWhileRevalidate: 60 * 60, // 1 heure de revalidation
    sMaxAge: 12 * 60 * 60, // 12 heures pour CDN
    immutable: false,
    mustRevalidate: false,
  },

  // Configuration spécifique pour un seul article
  singleBlogArticle: {
    maxAge: 8 * 60 * 60, // 8 heures (articles individuels changent moins)
    staleWhileRevalidate: 2 * 60 * 60, // 2 heures de revalidation
    sMaxAge: 24 * 60 * 60, // 24 heures pour CDN
    immutable: false,
    mustRevalidate: false,
  },

  // Configuration pour les templates (3 heures)
  templates: {
    maxAge: 3 * 60 * 60, // 3 heures (templates changent peu)
    staleWhileRevalidate: 60 * 60, // 1 heure
    sMaxAge: 6 * 60 * 60, // 6 heures pour CDN
    immutable: false,
    mustRevalidate: false,
  },

  // Configuration spécifique pour un template individuel
  singleTemplate: {
    maxAge: 6 * 60 * 60, // 6 heures
    staleWhileRevalidate: 2 * 60 * 60, // 2 heures
    sMaxAge: 12 * 60 * 60, // 12 heures pour CDN
    immutable: false,
    mustRevalidate: false,
  },

  // Configuration pour les applications (4 heures)
  applications: {
    maxAge: 4 * 60 * 60, // 4 heures
    staleWhileRevalidate: 60 * 60, // 1 heure
    sMaxAge: 8 * 60 * 60, // 8 heures pour CDN
    immutable: false,
    mustRevalidate: false,
  },

  // Configuration spécifique pour une application individuelle
  singleApplication: {
    maxAge: 6 * 60 * 60, // 6 heures
    staleWhileRevalidate: 2 * 60 * 60, // 2 heures
    sMaxAge: 12 * 60 * 60, // 12 heures pour CDN
    immutable: false,
    mustRevalidate: false,
  },

  // Configuration pour les commandes (2 minutes - données critiques)
  orders: {
    maxAge: 2 * 60, // 2 minutes car données financières
    staleWhileRevalidate: 30, // 30 secondes de revalidation
    immutable: false,
    mustRevalidate: true, // Doit revalider car données financières critiques
  },

  // Configuration pour les plateformes de paiement (10 minutes)
  platforms: {
    maxAge: 10 * 60, // 10 minutes (données de paiement sensibles mais stables)
    staleWhileRevalidate: 2 * 60, // 2 minutes de revalidation
    immutable: false,
    mustRevalidate: true, // Doit revalider car données de paiement
  },

  // Configuration pour les utilisateurs du dashboard (5 minutes)
  dashboardUsers: {
    maxAge: 5 * 60, // 5 minutes
    staleWhileRevalidate: 60, // 1 minute de revalidation
    immutable: false,
    mustRevalidate: true, // Doit revalider car données utilisateur sensibles
  },

  // Configuration pour les images Cloudinary (2 heures)
  cloudinaryImages: {
    maxAge: 2 * 60 * 60, // 2 heures pour métadonnées images
    staleWhileRevalidate: 30 * 60, // 30 minutes
    sMaxAge: 24 * 60 * 60, // 24 heures pour CDN
    immutable: false,
    mustRevalidate: false,
  },

  // Configuration pour les signatures Cloudinary (5 minutes)
  cloudinarySignatures: {
    maxAge: 5 * 60, // 5 minutes pour signatures
    staleWhileRevalidate: 0, // Pas de revalidation pour sécurité
    immutable: false,
    mustRevalidate: true, // Sécurité upload
  },

  // Durée de cache pour les pages statiques du dashboard (30 minutes)
  dashboardPages: {
    maxAge: 30 * 60, // 30 minutes
    staleWhileRevalidate: 10 * 60, // 10 minutes
    immutable: false,
    mustRevalidate: false,
  },

  // Durée de cache pour les ressources statiques (1 semaine)
  staticAssets: {
    maxAge: 7 * 24 * 60 * 60, // 1 semaine
    immutable: true,
  },

  // Configuration pour les statistiques du dashboard (1 minute)
  dashboardStats: {
    maxAge: 60, // 1 minute pour stats temps réel
    staleWhileRevalidate: 30, // 30 secondes
    immutable: false,
    mustRevalidate: false,
  },
};

/**
 * Génère les entêtes de cache pour Next.js selon le type de ressource
 * @param {string} resourceType - Type de ressource (templates, applications, articles, etc.)
 * @returns {Object} - Les entêtes de cache pour Next.js
 */
export function getCacheHeaders(resourceType) {
  const config = CACHE_CONFIGS[resourceType] || CACHE_CONFIGS.dashboardPages;

  if (config.noStore) {
    return {
      'Cache-Control': 'no-store',
    };
  }

  let cacheControl = `max-age=${config.maxAge}`;

  if (config.staleWhileRevalidate) {
    cacheControl += `, stale-while-revalidate=${config.staleWhileRevalidate}`;
  }

  if (config.sMaxAge) {
    cacheControl += `, s-maxage=${config.sMaxAge}`;
  }

  if (config.immutable) {
    cacheControl += ', immutable';
  }

  if (config.mustRevalidate) {
    cacheControl += ', must-revalidate';
  }

  return {
    'Cache-Control': cacheControl,
  };
}

// Implémentation EventEmitter compatible navigateur/Node.js pour le dashboard
export const cacheEvents = (() => {
  const listeners = {};

  return {
    on(event, callback) {
      listeners[event] = listeners[event] || [];
      listeners[event].push(callback);
      return this;
    },

    emit(event, data) {
      if (listeners[event]) {
        listeners[event].forEach((callback) => {
          try {
            callback(data);
          } catch (error) {
            console.error(`Cache event error: ${error.message}`);
          }
        });
      }
      return this;
    },

    off(event, callback) {
      if (!listeners[event]) return this;

      if (callback) {
        listeners[event] = listeners[event].filter((cb) => cb !== callback);
      } else {
        delete listeners[event];
      }

      return this;
    },

    once(event, callback) {
      const onceCallback = (data) => {
        this.off(event, onceCallback);
        callback(data);
      };

      return this.on(event, onceCallback);
    },
  };
})();

/**
 * Fonction utilitaire pour journaliser les erreurs de cache avec contexte dashboard
 * @param {Object} instance - Instance de cache
 * @param {string} operation - Opération qui a échoué
 * @param {string} key - Clé concernée
 * @param {Error} error - Erreur survenue
 */
function logCacheError(instance, operation, key, error) {
  const log = instance.log || console.debug;

  log(
    `Dashboard cache error during ${operation} for key '${key}': ${error.message}`,
  );

  // Log plus détaillé pour le développement
  if (process.env.NODE_ENV !== 'production') {
    log(error);
  }

  // Capturer l'exception pour Sentry en production avec contexte dashboard
  if (
    process.env.NODE_ENV === 'production' &&
    typeof captureException === 'function'
  ) {
    captureException(error, {
      tags: {
        component: 'dashboard_cache',
        operation,
        context: 'admin_dashboard',
      },
      extra: {
        key,
        cacheInfo: {
          size: instance.size || 0,
          calculatedSize: instance.calculatedSize || 0,
          maxSize: instance.maxSize || 0,
        },
        dashboardContext: {
          entityType: extractEntityType(key),
          isAdminCache: true,
        },
      },
    });
  }
}

/**
 * Extrait le type d'entité depuis une clé de cache pour le dashboard
 * @param {string} key - Clé de cache
 * @returns {string} Type d'entité détecté
 */
function extractEntityType(key) {
  if (key.includes('article') || key.includes('blog')) return 'blog';
  if (key.includes('template')) return 'template';
  if (key.includes('application')) return 'application';
  if (key.includes('order')) return 'order';
  if (key.includes('platform')) return 'platform';
  if (key.includes('user') || key.includes('auth')) return 'user';
  if (key.includes('cloudinary')) return 'media';
  return 'generic';
}

/**
 * Sérialise une valeur pour le stockage avec compression optimisée pour le dashboard
 * @param {any} value - Valeur à sérialiser
 * @param {boolean} useCompression - Si true, compresse les grandes valeurs
 * @returns {Object} Objet avec la valeur et métadonnées
 * @throws {Error} Si la valeur ne peut pas être sérialisée/compressée
 */
function serializeValue(value, useCompression = false) {
  try {
    const serialized = JSON.stringify(value);
    const size = serialized.length;

    // Compression pour les grandes valeurs du dashboard (articles avec contenu riche, listes)
    if (useCompression && size > 8000) {
      // 8KB seuil pour dashboard
      const compressed = compress(serialized);
      return {
        value: compressed,
        originalSize: size,
        compressed: true,
        size: compressed.length,
        entityType: detectEntityType(value),
      };
    }

    return {
      value: serialized,
      size,
      compressed: false,
      entityType: detectEntityType(value),
    };
  } catch (error) {
    throw new Error(
      `Failed to serialize dashboard cache value: ${error.message}`,
    );
  }
}

/**
 * Détecte le type d'entité à partir de la valeur pour optimisations spécifiques
 * @param {any} value - Valeur à analyser
 * @returns {string} Type d'entité détecté
 */
function detectEntityType(value) {
  if (!value || typeof value !== 'object') return 'generic';

  // Détection basée sur les propriétés des entités du dashboard
  if (value.article_id || value.article_title) return 'blog_article';
  if (value.template_id || value.template_name) return 'template';
  if (value.application_id || value.application_name) return 'application';
  if (value.order_id || value.order_payment_status) return 'order';
  if (value.platform_id || value.platform_name) return 'platform';
  if (value.user_id || value.user_email) return 'user';
  if (Array.isArray(value)) {
    if (value.length > 0) return detectEntityType(value[0]) + '_list';
    return 'empty_list';
  }

  return 'generic';
}

/**
 * Désérialise une valeur du cache
 * @param {Object} storedData - Données stockées
 * @returns {any} Valeur désérialisée
 * @throws {Error} Si la valeur ne peut pas être désérialisée
 */
function deserializeValue(storedData) {
  try {
    if (!storedData) return null;

    const value = storedData.compressed
      ? decompress(storedData.value)
      : storedData.value;

    return JSON.parse(value);
  } catch (error) {
    throw new Error(
      `Failed to deserialize dashboard cache value: ${error.message}`,
    );
  }
}

/**
 * Classe utilitaire pour gérer un cache avec lru-cache, optimisée pour le dashboard admin
 */
export class DashboardMemoryCache {
  /**
   * Crée une nouvelle instance du cache pour le dashboard
   * @param {Object|number} options - Options de configuration ou TTL
   */
  constructor(options = {}) {
    const opts = typeof options === 'number' ? { ttl: options } : options;

    const {
      ttl = 60 * 1000,
      maxSize = 500, // Taille adaptée pour dashboard admin
      maxBytes = 100 * 1024 * 1024, // 100MB pour dashboard avec images
      logFunction = console.debug,
      compress = true, // Compression activée par défaut pour dashboard
      name = 'dashboard-cache',
      entityType = 'generic',
    } = opts;

    this.ttl = ttl;
    this.maxSize = maxSize;
    this.maxBytes = maxBytes;
    this.log = logFunction;
    this.compress = compress;
    this.name = name;
    this.entityType = entityType;
    this.cleanupIntervalId = null;
    this.currentBytes = 0;
    this.locks = new Map();
    this.hitRate = { hits: 0, misses: 0 };

    // Initialisation du cache LRU optimisé pour le dashboard
    this.cache = new LRUCache({
      max: maxSize,
      ttl: ttl,
      sizeCalculation: (value, key) => {
        return value.data?.size || 0;
      },
      maxSize: maxBytes,
      allowStale: false,
      updateAgeOnGet: true,
      updateAgeOnHas: false,
      // Événements spécifiques au dashboard
      disposeAfter: (value, key) => {
        if (value.data?.size) {
          this.currentBytes -= value.data.size;
        }
        cacheEvents.emit('dashboard_delete', {
          key,
          cache: this,
          entityType: value.data?.entityType || this.entityType,
        });
      },
    });

    // Démarrer le nettoyage périodique adapté au dashboard
    this._startCleanupInterval();
  }

  /**
   * Obtenir une valeur du cache avec verrouillage pour éviter les conditions de course
   * @param {string} key - Clé de cache
   * @returns {Promise<any>} - Valeur en cache ou null si absente/expirée
   */
  async getWithLock(key) {
    if (this.locks.has(key)) {
      await this.locks.get(key);
    }

    let resolver;
    const lock = new Promise((resolve) => {
      resolver = resolve;
    });
    this.locks.set(key, lock);

    try {
      return this.get(key);
    } finally {
      this.locks.delete(key);
      resolver();
    }
  }

  /**
   * Obtenir une valeur du cache avec métriques dashboard
   * @param {string} key - Clé de cache
   * @returns {any|null} - Valeur en cache ou null si absente/expirée
   */
  get(key) {
    try {
      const entry = this.cache.get(key);

      if (!entry) {
        this.hitRate.misses++;
        cacheEvents.emit('dashboard_miss', {
          key,
          cache: this,
          entityType: this.entityType,
          hitRate: this.getHitRate(),
        });
        return null;
      }

      this.hitRate.hits++;
      cacheEvents.emit('dashboard_hit', {
        key,
        cache: this,
        entityType: entry.data?.entityType || this.entityType,
        hitRate: this.getHitRate(),
      });

      return deserializeValue(entry.data);
    } catch (error) {
      logCacheError(this, 'get', key, error);
      cacheEvents.emit('dashboard_error', {
        error,
        operation: 'get',
        key,
        cache: this,
        entityType: this.entityType,
      });
      return null;
    }
  }

  /**
   * Mettre une valeur en cache avec optimisations dashboard
   * @param {string} key - Clé de cache
   * @param {any} value - Valeur à mettre en cache
   * @param {Object|number} options - Options ou durée de vie personnalisée
   * @returns {boolean} - True si l'opération a réussi
   */
  set(key, value, options = {}) {
    try {
      // Validation de la clé
      if (!key || typeof key !== 'string') {
        throw new Error('Invalid dashboard cache key');
      }

      // Nettoyer les options
      const opts = typeof options === 'number' ? { ttl: options } : options;
      const ttl = opts.ttl || this.ttl;
      const compress =
        opts.compress !== undefined ? opts.compress : this.compress;

      // Sérialiser la valeur avec détection d'entité
      const serialized = serializeValue(value, compress);

      // Vérifier la taille (limite adaptée au dashboard)
      if (serialized.size > this.maxBytes * 0.15) {
        // 15% du cache max
        this.log(
          `Dashboard cache entry too large: ${key} (${serialized.size} bytes)`,
        );
        return false;
      }

      // Si la clé existe déjà, soustraire sa taille actuelle
      const existingEntry = this.cache.get(key);
      if (existingEntry?.data?.size) {
        this.currentBytes -= existingEntry.data.size;
      }

      // Ajouter au cache avec TTL spécifique et métadonnées dashboard
      const entry = {
        data: serialized,
        lastAccessed: Date.now(),
        dashboardMetadata: {
          entityType: serialized.entityType,
          cacheInstance: this.name,
          compressionUsed: serialized.compressed,
        },
      };

      this.cache.set(key, entry, {
        ttl: ttl,
        size: serialized.size,
      });

      // Mettre à jour la taille totale
      this.currentBytes += serialized.size;

      cacheEvents.emit('dashboard_set', {
        key,
        size: serialized.size,
        cache: this,
        entityType: serialized.entityType,
        compressed: serialized.compressed,
      });

      return true;
    } catch (error) {
      logCacheError(this, 'set', key, error);
      cacheEvents.emit('dashboard_error', {
        error,
        operation: 'set',
        key,
        cache: this,
        entityType: this.entityType,
      });
      return false;
    }
  }

  /**
   * Supprimer une valeur du cache
   * @param {string} key - Clé de cache
   * @returns {boolean} - True si la valeur existait
   */
  delete(key) {
    try {
      const hadKey = this.cache.has(key);
      this.cache.delete(key);
      return hadKey;
    } catch (error) {
      logCacheError(this, 'delete', key, error);
      return false;
    }
  }

  /**
   * Vider tout le cache
   * @returns {boolean} - True si l'opération a réussi
   */
  clear() {
    try {
      this.cache.clear();
      this.currentBytes = 0;
      this.hitRate = { hits: 0, misses: 0 };
      cacheEvents.emit('dashboard_clear', {
        cache: this,
        entityType: this.entityType,
      });
      return true;
    } catch (error) {
      logCacheError(this, 'clear', 'all', error);
      return false;
    }
  }

  /**
   * Obtenir les statistiques du cache spécifiques au dashboard
   * @returns {Object} - Statistiques détaillées du cache
   */
  size() {
    const hitRate = this.getHitRate();
    return {
      entries: this.cache.size,
      bytes: this.currentBytes,
      maxEntries: this.maxSize,
      maxBytes: this.maxBytes,
      utilization: Math.round((this.currentBytes / this.maxBytes) * 100) / 100,
      hitRate: hitRate,
      efficiency: hitRate > 0.7 ? 'excellent' : hitRate > 0.5 ? 'good' : 'poor',
      entityType: this.entityType,
      name: this.name,
    };
  }

  /**
   * Calculer le taux de succès du cache
   * @returns {number} Taux de succès entre 0 et 1
   */
  getHitRate() {
    const total = this.hitRate.hits + this.hitRate.misses;
    return total > 0 ? this.hitRate.hits / total : 0;
  }

  /**
   * Supprimer toutes les entrées correspondant à un pattern (utile pour invalidation par entité)
   * @param {RegExp|string} pattern - Pattern de clé à supprimer
   * @returns {number} - Nombre d'entrées supprimées
   */
  invalidatePattern(pattern) {
    try {
      const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
      const keysToDelete = [];

      // Collecter d'abord les clés pour éviter de modifier pendant l'itération
      for (const key of this.cache.keys()) {
        if (regex.test(key)) {
          keysToDelete.push(key);
        }
      }

      // Supprimer les clés collectées
      keysToDelete.forEach((key) => this.delete(key));

      cacheEvents.emit('dashboard_invalidatePattern', {
        pattern: pattern.toString(),
        count: keysToDelete.length,
        cache: this,
        entityType: this.entityType,
      });

      return keysToDelete.length;
    } catch (error) {
      logCacheError(this, 'invalidatePattern', pattern.toString(), error);
      return 0;
    }
  }

  /**
   * Invalider le cache par type d'entité du dashboard
   * @param {string} entityType - Type d'entité à invalider
   * @returns {number} Nombre d'entrées invalidées
   */
  invalidateByEntityType(entityType) {
    try {
      const keysToDelete = [];

      for (const [key, entry] of this.cache.entries()) {
        if (
          entry.data?.entityType === entityType ||
          entry.dashboardMetadata?.entityType === entityType ||
          key.includes(entityType)
        ) {
          keysToDelete.push(key);
        }
      }

      keysToDelete.forEach((key) => this.delete(key));

      this.log(
        `Dashboard cache: Invalidated ${keysToDelete.length} entries for entity type: ${entityType}`,
      );

      return keysToDelete.length;
    } catch (error) {
      logCacheError(this, 'invalidateByEntityType', entityType, error);
      return 0;
    }
  }

  /**
   * Nettoie les entrées expirées du cache
   * @returns {number} - Nombre d'entrées nettoyées
   */
  cleanup() {
    try {
      // LRU Cache gère déjà automatiquement l'expiration
      this.cache.purgeStale();
      return 0;
    } catch (error) {
      logCacheError(this, 'cleanup', 'all', error);
      return 0;
    }
  }

  /**
   * Démarre l'intervalle de nettoyage automatique adapté au dashboard
   * @private
   */
  _startCleanupInterval() {
    if (typeof setInterval !== 'undefined' && !this.cleanupIntervalId) {
      // Nettoyer toutes les 3 minutes pour le dashboard (plus fréquent)
      this.cleanupIntervalId = setInterval(
        () => {
          this.cleanup();

          // Log des stats périodiques en développement
          if (process.env.NODE_ENV !== 'production') {
            const stats = this.size();
            if (stats.entries > 0) {
              this.log(`Dashboard cache stats [${this.name}]:`, stats);
            }
          }
        },
        3 * 60 * 1000,
      );

      // Assurer que l'intervalle ne bloque pas le garbage collector
      if (
        this.cleanupIntervalId &&
        typeof this.cleanupIntervalId === 'object'
      ) {
        this.cleanupIntervalId.unref?.();
      }
    }
  }

  /**
   * Arrête l'intervalle de nettoyage automatique
   */
  stopCleanupInterval() {
    if (this.cleanupIntervalId && typeof clearInterval !== 'undefined') {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
  }

  /**
   * S'assure que les ressources sont libérées lors de la destruction
   */
  destroy() {
    this.stopCleanupInterval();
    this.clear();
  }

  /**
   * Récupère en cache si disponible, sinon exécute la fonction et met en cache
   * @param {string} key - Clé de cache
   * @param {Function} fn - Fonction à exécuter si cache manquant
   * @param {Object} options - Options de cache
   * @returns {Promise<any>} - Valeur en cache ou résultat de la fonction
   */
  async getOrSet(key, fn, options = {}) {
    const cachedValue = this.get(key);
    if (cachedValue !== null) {
      return cachedValue;
    }

    try {
      const result = await Promise.resolve(fn());
      this.set(key, result, options);
      return result;
    } catch (error) {
      logCacheError(this, 'getOrSet', key, error);
      throw error;
    }
  }
}

/**
 * Fonction utilitaire pour obtenir une clé de cache canonique adaptée au dashboard
 * @param {string} prefix - Préfixe de la clé (blog, template, application, etc.)
 * @param {Object} params - Paramètres pour générer la clé
 * @returns {string} - Clé de cache unique
 */
export function getDashboardCacheKey(prefix, params = {}) {
  // Vérifier et nettoyer les entrées pour la sécurité
  const cleanParams = {};

  for (const [key, value] of Object.entries(params)) {
    // Ignorer les valeurs nulles ou undefined
    if (value === undefined || value === null) continue;

    // Éviter les injections en supprimant les caractères spéciaux
    const cleanKey = String(key).replace(/[^a-zA-Z0-9_-]/g, '');
    let cleanValue;

    // Traiter différemment selon le type
    if (typeof value === 'object') {
      cleanValue = JSON.stringify(value);
    } else {
      cleanValue = String(value);
    }

    // Limiter la taille des valeurs pour éviter des clés trop longues
    if (cleanValue.length > 100) {
      cleanValue = cleanValue.substring(0, 97) + '...';
    }

    cleanParams[cleanKey] = encodeURIComponent(cleanValue);
  }

  // Trier les paramètres pour garantir l'unicité
  const sortedParams = Object.keys(cleanParams)
    .sort()
    .map((key) => `${key}=${cleanParams[key]}`)
    .join('&');

  // Préfixe validé pour le dashboard
  const safePrefix = String(prefix).replace(/[^a-zA-Z0-9_-]/g, '');

  return `dashboard:${safePrefix}:${sortedParams || 'default'}`;
}

/**
 * Crée une fonction memoizée avec intégration du système de cache dashboard
 * @param {Function} fn - Fonction à mettre en cache
 * @param {Object} options - Options de cache
 * @returns {Function} - Fonction mise en cache
 */
export function createDashboardCachedFunction(fn, options = {}) {
  const {
    ttl = 5 * 60 * 1000, // 5 minutes par défaut pour dashboard
    maxEntries = 200, // Plus d'entrées pour dashboard
    keyGenerator = (...args) => JSON.stringify(args),
    name = fn.name || 'anonymous',
    entityType = 'generic',
  } = options;

  // Vérifier si memoizeWithTTL est disponible
  if (typeof memoizeWithTTL === 'function') {
    return memoizeWithTTL(fn, ttl);
  }

  // Créer un cache dédié pour cette fonction
  const functionCache = new DashboardMemoryCache({
    ttl,
    maxSize: maxEntries,
    name: `function-${name}`,
    entityType,
    logFunction: (msg) => console.debug(`[DashboardCachedFn:${name}] ${msg}`),
  });

  // Créer la fonction enveloppante
  return async function (...args) {
    try {
      const cacheKey = keyGenerator(...args);

      // Vérifier le cache
      const cachedResult = functionCache.get(cacheKey);
      if (cachedResult !== null) {
        return cachedResult;
      }

      // Exécuter la fonction
      const result = await Promise.resolve(fn.apply(this, args));

      // Mettre en cache
      functionCache.set(cacheKey, result);

      return result;
    } catch (error) {
      logCacheError(functionCache, 'execution', fn.name, error);
      throw error;
    }
  };
}

// Instances de cache pour l'application dashboard avec configurations optimisées
export const dashboardCache = {
  // Cache pour les utilisateurs authentifiés NextAuth
  authUsers: new DashboardMemoryCache({
    ttl: CACHE_CONFIGS.authUsers.maxAge * 1000,
    maxSize: 500, // Capacité pour utilisateurs dashboard
    compress: false, // Pas de compression pour données auth rapides
    name: 'auth-users',
    entityType: 'auth_user',
    logFunction: (msg) => console.debug(`[AuthUserCache] ${msg}`),
  }),

  // Cache pour les sessions NextAuth
  authSessions: new DashboardMemoryCache({
    ttl: CACHE_CONFIGS.authSessions.maxAge * 1000,
    maxSize: 200,
    compress: false,
    name: 'auth-sessions',
    entityType: 'auth_session',
    logFunction: (msg) => console.debug(`[AuthSessionCache] ${msg}`),
  }),

  // Cache pour les articles de blog
  blogArticles: new DashboardMemoryCache({
    ttl: CACHE_CONFIGS.blogArticles.maxAge * 1000,
    maxSize: 300, // Articles avec contenu riche
    compress: true, // Compression pour articles longs
    name: 'blog-articles',
    entityType: 'blog_article',
    logFunction: (msg) => console.debug(`[BlogCache] ${msg}`),
  }),

  // Cache spécifique pour un article individuel
  singleBlogArticle: new DashboardMemoryCache({
    ttl: CACHE_CONFIGS.singleBlogArticle.maxAge * 1000,
    maxSize: 500, // Plus d'entrées pour articles individuels
    compress: true,
    name: 'single-blog-article',
    entityType: 'single_blog_article',
    logFunction: (msg) => console.debug(`[SingleBlogCache] ${msg}`),
  }),

  // Cache pour les templates
  templates: new DashboardMemoryCache({
    ttl: CACHE_CONFIGS.templates.maxAge * 1000,
    maxSize: 200, // Templates relativement peu nombreux
    compress: true,
    name: 'templates',
    entityType: 'template',
    logFunction: (msg) => console.debug(`[TemplateCache] ${msg}`),
  }),

  // Cache spécifique pour un template individuel
  singleTemplate: new DashboardMemoryCache({
    ttl: CACHE_CONFIGS.singleTemplate.maxAge * 1000,
    maxSize: 400,
    compress: true,
    name: 'single-template',
    entityType: 'single_template',
    logFunction: (msg) => console.debug(`[SingleTemplateCache] ${msg}`),
  }),

  // Cache pour les applications
  applications: new DashboardMemoryCache({
    ttl: CACHE_CONFIGS.applications.maxAge * 1000,
    maxSize: 400, // Applications avec métadonnées
    compress: true,
    name: 'applications',
    entityType: 'application',
    logFunction: (msg) => console.debug(`[ApplicationCache] ${msg}`),
  }),

  // Cache spécifique pour une application individuelle
  singleApplication: new DashboardMemoryCache({
    ttl: CACHE_CONFIGS.singleApplication.maxAge * 1000,
    maxSize: 600,
    compress: true,
    name: 'single-application',
    entityType: 'single_application',
    logFunction: (msg) => console.debug(`[SingleApplicationCache] ${msg}`),
  }),

  // Cache pour les commandes (données critiques)
  orders: new DashboardMemoryCache({
    ttl: CACHE_CONFIGS.orders.maxAge * 1000,
    maxSize: 100, // Cache limité pour données financières
    compress: true,
    name: 'orders',
    entityType: 'order',
    logFunction: (msg) => console.debug(`[OrdersCache] ${msg}`),
  }),

  // Cache pour les plateformes de paiement
  platforms: new DashboardMemoryCache({
    ttl: CACHE_CONFIGS.platforms.maxAge * 1000,
    maxSize: 50, // Peu de plateformes
    compress: false, // Données légères
    name: 'platforms',
    entityType: 'platform',
    logFunction: (msg) => console.debug(`[PlatformsCache] ${msg}`),
  }),

  // Cache pour les utilisateurs du dashboard
  dashboardUsers: new DashboardMemoryCache({
    ttl: CACHE_CONFIGS.dashboardUsers.maxAge * 1000,
    maxSize: 150,
    compress: false,
    name: 'dashboard-users',
    entityType: 'dashboard_user',
    logFunction: (msg) => console.debug(`[DashboardUsersCache] ${msg}`),
  }),

  // Cache pour les métadonnées d'images Cloudinary
  cloudinaryImages: new DashboardMemoryCache({
    ttl: CACHE_CONFIGS.cloudinaryImages.maxAge * 1000,
    maxSize: 1000, // Beaucoup d'images possible
    compress: false, // Métadonnées légères
    name: 'cloudinary-images',
    entityType: 'cloudinary_image',
    logFunction: (msg) => console.debug(`[CloudinaryCache] ${msg}`),
  }),

  // Cache pour les signatures Cloudinary
  cloudinarySignatures: new DashboardMemoryCache({
    ttl: CACHE_CONFIGS.cloudinarySignatures.maxAge * 1000,
    maxSize: 100, // Signatures temporaires
    compress: false,
    name: 'cloudinary-signatures',
    entityType: 'cloudinary_signature',
    logFunction: (msg) => console.debug(`[CloudinarySignaturesCache] ${msg}`),
  }),

  // Cache pour les statistiques du dashboard
  dashboardStats: new DashboardMemoryCache({
    ttl: CACHE_CONFIGS.dashboardStats.maxAge * 1000,
    maxSize: 50, // Stats limitées
    compress: false,
    name: 'dashboard-stats',
    entityType: 'dashboard_stat',
    logFunction: (msg) => console.debug(`[DashboardStatsCache] ${msg}`),
  }),
};

/**
 * Invalide le cache pour une entité spécifique du dashboard
 * @param {string} entityType - Type d'entité (blog, template, application, etc.)
 * @param {string|number} entityId - ID spécifique de l'entité (optionnel)
 */
export function invalidateDashboardCache(entityType, entityId = null) {
  let invalidatedCount = 0;

  // Mapper les types d'entités aux caches appropriés
  const entityCacheMap = {
    blog: ['blogArticles', 'singleBlogArticle'],
    article: ['blogArticles', 'singleBlogArticle'],
    template: ['templates', 'singleTemplate'],
    application: ['applications', 'singleApplication'],
    order: ['orders'],
    platform: ['platforms'],
    user: ['dashboardUsers', 'authUsers'],
    auth: ['authUsers', 'authSessions'],
    cloudinary: ['cloudinaryImages', 'cloudinarySignatures'],
    stats: ['dashboardStats'],
  };

  const cachesToInvalidate = entityCacheMap[entityType] || [];

  cachesToInvalidate.forEach((cacheName) => {
    const cache = dashboardCache[cacheName];
    if (cache) {
      if (entityId) {
        // Invalider par pattern incluant l'ID
        const pattern = new RegExp(`${entityType}.*${entityId}`);
        invalidatedCount += cache.invalidatePattern(pattern);
      } else {
        // Invalider tout le type d'entité
        invalidatedCount += cache.invalidateByEntityType(entityType);
      }
    }
  });

  console.debug(
    `Dashboard cache: Invalidated ${invalidatedCount} entries for ${entityType}${entityId ? ` (ID: ${entityId})` : ''}`,
  );

  // Émettre un événement global d'invalidation
  cacheEvents.emit('dashboard_invalidation', {
    entityType,
    entityId,
    invalidatedCount,
    timestamp: Date.now(),
  });

  return invalidatedCount;
}

/**
 * Obtient les statistiques globales de tous les caches du dashboard
 * @returns {Object} Statistiques complètes
 */
export function getDashboardCacheStats() {
  const stats = {
    timestamp: new Date().toISOString(),
    caches: {},
    totals: {
      entries: 0,
      bytes: 0,
      hitRate: 0,
      efficiency: 'unknown',
    },
  };

  let totalHits = 0;
  let totalRequests = 0;

  Object.entries(dashboardCache).forEach(([cacheName, cache]) => {
    const cacheStats = cache.size();
    stats.caches[cacheName] = cacheStats;

    stats.totals.entries += cacheStats.entries;
    stats.totals.bytes += cacheStats.bytes;

    const cacheRequests = cache.hitRate.hits + cache.hitRate.misses;
    totalHits += cache.hitRate.hits;
    totalRequests += cacheRequests;
  });

  // Calculer le taux de succès global
  stats.totals.hitRate = totalRequests > 0 ? totalHits / totalRequests : 0;
  stats.totals.efficiency =
    stats.totals.hitRate > 0.8
      ? 'excellent'
      : stats.totals.hitRate > 0.6
        ? 'good'
        : stats.totals.hitRate > 0.4
          ? 'average'
          : 'poor';

  return stats;
}

/**
 * Nettoie tous les caches du dashboard
 * @param {boolean} force - Forcer le nettoyage même en production
 */
export function cleanupDashboardCaches(force = false) {
  if (process.env.NODE_ENV === 'production' && !force) {
    console.warn(
      'Dashboard cache cleanup skipped in production. Use force=true to override.',
    );
    return;
  }

  let totalCleaned = 0;

  Object.entries(dashboardCache).forEach(([cacheName, cache]) => {
    const sizeBefore = cache.size().entries;
    cache.cleanup();
    const sizeAfter = cache.size().entries;
    const cleaned = sizeBefore - sizeAfter;
    totalCleaned += cleaned;

    if (cleaned > 0) {
      console.debug(
        `Dashboard cache [${cacheName}]: Cleaned ${cleaned} expired entries`,
      );
    }
  });

  console.debug(`Dashboard cache: Total cleaned entries: ${totalCleaned}`);

  cacheEvents.emit('dashboard_cleanup', {
    totalCleaned,
    timestamp: Date.now(),
  });

  return totalCleaned;
}

/**
 * Réinitialise tous les caches du dashboard
 * @param {boolean} force - Forcer la réinitialisation même en production
 */
export function resetDashboardCaches(force = false) {
  if (process.env.NODE_ENV === 'production' && !force) {
    console.warn(
      'Dashboard cache reset skipped in production. Use force=true to override.',
    );
    return;
  }

  const statsBefore = getDashboardCacheStats();

  Object.entries(dashboardCache).forEach(([cacheName, cache]) => {
    cache.clear();
    console.debug(`Dashboard cache [${cacheName}]: Reset completed`);
  });

  console.debug('All dashboard caches have been reset');

  cacheEvents.emit('dashboard_reset', {
    statsBefore,
    timestamp: Date.now(),
  });
}

/**
 * Middleware pour automatiquement invalider le cache après les mutations du dashboard
 * @param {string} entityType - Type d'entité modifiée
 * @param {Function} operation - Fonction qui effectue la mutation
 * @returns {Function} Fonction wrapped qui invalide le cache
 */
export function withDashboardCacheInvalidation(entityType, operation) {
  return async function (...args) {
    // Exécuter l'opération
    const result = await Promise.resolve(operation.apply(this, args));

    // Invalider le cache approprié après succès
    invalidateDashboardCache(entityType);

    return result;
  };
}

/**
 * Hook pour les opérations CRUD avec invalidation automatique du cache
 * @param {string} entityType - Type d'entité
 * @returns {Object} Fonctions CRUD avec cache
 */
export function useDashboardCacheOperations(entityType) {
  const cacheKey = (operation, id = null) =>
    getDashboardCacheKey(`${entityType}_${operation}`, { id });

  return {
    // Create avec invalidation
    create: withDashboardCacheInvalidation(entityType, async (data) => {
      // L'opération create sera passée en paramètre
      throw new Error('Create operation must be implemented');
    }),

    // Read avec cache
    read: createDashboardCachedFunction(
      async (id) => {
        throw new Error('Read operation must be implemented');
      },
      {
        ttl: CACHE_CONFIGS[entityType]?.maxAge * 1000 || 5 * 60 * 1000,
        entityType,
        name: `read_${entityType}`,
      },
    ),

    // Update avec invalidation
    update: withDashboardCacheInvalidation(entityType, async (id, data) => {
      throw new Error('Update operation must be implemented');
    }),

    // Delete avec invalidation
    delete: withDashboardCacheInvalidation(entityType, async (id) => {
      throw new Error('Delete operation must be implemented');
    }),

    // Invalidation manuelle
    invalidate: (id = null) => invalidateDashboardCache(entityType, id),
  };
}

// Enregistrer un handler pour nettoyer les caches à l'arrêt de l'application
if (typeof process !== 'undefined' && process.on) {
  process.on('SIGTERM', () => {
    console.debug('Dashboard cache: Cleaning up on SIGTERM');
    Object.values(dashboardCache).forEach((cache) => {
      if (cache && typeof cache.destroy === 'function') {
        cache.destroy();
      }
    });
  });

  process.on('SIGINT', () => {
    console.debug('Dashboard cache: Cleaning up on SIGINT');
    Object.values(dashboardCache).forEach((cache) => {
      if (cache && typeof cache.destroy === 'function') {
        cache.destroy();
      }
    });
  });
}

// Nettoyage périodique en développement
if (process.env.NODE_ENV !== 'production') {
  setInterval(
    () => {
      cleanupDashboardCaches();
    },
    10 * 60 * 1000,
  ); // 10 minutes
}

// Export des utilitaires principaux pour compatibilité
export const getCacheKey = getDashboardCacheKey;
export const createCachedFunction = createDashboardCachedFunction;
export const MemoryCache = DashboardMemoryCache;
export const appCache = dashboardCache; // Alias pour compatibilité

// Export par défaut
export default {
  CACHE_CONFIGS,
  getCacheHeaders,
  getDashboardCacheKey,
  createDashboardCachedFunction,
  DashboardMemoryCache,
  dashboardCache,
  invalidateDashboardCache,
  getDashboardCacheStats,
  cleanupDashboardCaches,
  resetDashboardCaches,
  withDashboardCacheInvalidation,
  useDashboardCacheOperations,
  cacheEvents,
};
