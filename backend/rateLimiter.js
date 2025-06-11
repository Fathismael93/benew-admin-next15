/**
 * Système de rate limiting avancé pour Next.js
 * Inspiré d'integratedRateLimit.js avec analyse comportementale et sécurité renforcée
 * Sans dépendances externes - Version avec monitoring Sentry et logging Winston
 */

import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import logger from '@/utils/logger';
import { captureException, captureMessage } from '@/monitoring/sentry';

/**
 * Types de préréglages pour différents endpoints
 * @enum {Object}
 */
export const RATE_LIMIT_PRESETS = {
  // API publiques (non-authentifiées)
  PUBLIC_API: {
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 requêtes par minute
    message: 'Trop de requêtes, veuillez réessayer plus tard',
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
  },
  // API authentifiées (utilisateur connecté)
  AUTHENTICATED_API: {
    windowMs: 60 * 1000, // 1 minute
    max: 120, // 120 requêtes par minute
    message: 'Trop de requêtes, veuillez réessayer plus tard',
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
  },
  // Endpoints d'authentification (login/register)
  AUTH_ENDPOINTS: {
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 10, // 10 tentatives par 10 minutes
    message:
      "Trop de tentatives d'authentification, veuillez réessayer plus tard",
    skipSuccessfulRequests: true, // Ne pas compter les connexions réussies
    skipFailedRequests: false,
  },
  // Upload d'images (Cloudinary)
  IMAGE_UPLOAD: {
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 20, // 20 uploads par 5 minutes
    message: "Trop d'uploads d'images, veuillez réessayer plus tard",
    skipSuccessfulRequests: false,
    skipFailedRequests: true, // Ne pas compter les échecs d'upload
  },
  // APIs sensibles (blog, templates, applications)
  CONTENT_API: {
    windowMs: 2 * 60 * 1000, // 2 minutes
    max: 15, // 15 requêtes par 2 minutes
    message: 'Trop de requêtes de contenu, veuillez réessayer plus tard',
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
  },
};

/**
 * Niveaux de sévérité pour les violations du rate limit
 * @enum {Object}
 */
export const VIOLATION_LEVELS = {
  LOW: {
    threshold: 1.2, // Dépassement de 20% de la limite
    blockDuration: 0, // Pas de blocage supplémentaire
    severity: 'low',
    logLevel: 'info',
    sentryLevel: 'info',
  },
  MEDIUM: {
    threshold: 2, // Double de la limite
    blockDuration: 5 * 60 * 1000, // 5 minutes
    severity: 'medium',
    logLevel: 'warning',
    sentryLevel: 'warning',
  },
  HIGH: {
    threshold: 5, // 5x la limite
    blockDuration: 30 * 60 * 1000, // 30 minutes
    severity: 'high',
    logLevel: 'warning',
    sentryLevel: 'warning',
  },
  SEVERE: {
    threshold: 10, // 10x la limite
    blockDuration: 24 * 60 * 60 * 1000, // 24 heures
    severity: 'severe',
    logLevel: 'error',
    sentryLevel: 'error',
  },
};

// Stockage en mémoire simple (Map natives)
const requestCache = new Map();
const blockedIPs = new Map();
const suspiciousBehavior = new Map();

// Liste blanche des IPs exemptées
const IP_WHITELIST = new Set([
  '127.0.0.1',
  '::1',
  // Ajoutez vos IPs de confiance ici
]);

/**
 * Fonction pour extraire l'IP réelle d'une requête
 * @param {Object} req - La requête HTTP
 * @returns {string} L'IP réelle du client
 */
function extractRealIp(req) {
  // Gestion des headers de proxy pour Vercel/Cloudflare
  const forwardedFor =
    req.headers.get?.('x-forwarded-for') || req.headers['x-forwarded-for'];
  const realIp = req.headers.get?.('x-real-ip') || req.headers['x-real-ip'];
  const cfConnectingIp =
    req.headers.get?.('cf-connecting-ip') || req.headers['cf-connecting-ip'];

  let ip = '0.0.0.0';

  if (cfConnectingIp) {
    ip = cfConnectingIp;
  } else if (forwardedFor) {
    ip = forwardedFor.split(',')[0].trim();
  } else if (realIp) {
    ip = realIp;
  } else if (req.socket?.remoteAddress) {
    ip = req.socket.remoteAddress;
  } else if (req.ip) {
    ip = req.ip;
  }

  // Nettoyer l'IP (enlever les préfixes IPv6)
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }

  return ip;
}

/**
 * Fonction d'anonymisation d'IP pour les logs
 * @param {string} ip - L'adresse IP à anonymiser
 * @returns {string} L'IP anonymisée
 */
function anonymizeIp(ip) {
  if (!ip || typeof ip !== 'string') return '0.0.0.0';

  // Gestion IPv4 et IPv6
  if (ip.includes('.')) {
    // IPv4: Masquer le dernier octet
    const parts = ip.split('.');
    if (parts.length === 4) {
      parts[3] = 'xxx';
      return parts.join('.');
    }
  } else if (ip.includes(':')) {
    // IPv6: Ne garder que le préfixe
    const parts = ip.split(':');
    if (parts.length >= 4) {
      return parts.slice(0, 4).join(':') + '::xxx';
    }
  }

  return ip.substring(0, Math.floor(ip.length / 2)) + 'xxx';
}

/**
 * Générer une clé unique pour cette requête
 * @param {Object} req - Requête Next.js
 * @param {string} prefix - Préfixe pour la clé
 * @param {Object} options - Options supplémentaires
 * @returns {string} Clé unique
 */
function generateKey(req, prefix = 'api', options = {}) {
  const ip = extractRealIp(req);

  // Si on a des informations d'authentification
  if (options.keyGenerator && typeof options.keyGenerator === 'function') {
    return options.keyGenerator(req);
  }

  // Pour les APIs d'authentification, on peut inclure l'email dans la clé
  if (prefix === 'auth' && req.body) {
    try {
      const body =
        typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (body.email) {
        const emailHash = Buffer.from(body.email)
          .toString('base64')
          .substring(0, 8);
        return `${prefix}:email:${emailHash}:ip:${ip}`;
      }
    } catch (e) {
      // Ignore les erreurs de parsing
    }
  }

  // Par défaut, utiliser l'IP
  return `${prefix}:ip:${ip}`;
}

/**
 * Classification des erreurs par catégorie pour rate limiting
 * @param {Error} error - L'erreur à classifier
 * @returns {string} Catégorie de l'erreur
 */
function categorizeRateLimitError(error) {
  if (!error) return 'unknown';

  const message = error.message || '';
  const name = error.name || '';
  const combinedText = (message + name).toLowerCase();

  if (/rate.?limit|too.?many.?requests|429/i.test(combinedText)) {
    return 'rate_limiting';
  }

  if (/network|fetch|http|request|response|api|axios/i.test(combinedText)) {
    return 'network';
  }

  if (
    /auth|permission|token|unauthorized|forbidden|session/i.test(combinedText)
  ) {
    return 'authentication';
  }

  if (/validation|schema|required|invalid|yup/i.test(combinedText)) {
    return 'validation';
  }

  return 'rate_limiting';
}

/**
 * Analyser le comportement suspect en fonction des modèles de requête
 * @param {string} key - Clé d'identification
 * @param {string} endpoint - Endpoint appelé
 * @returns {Object} Résultat de l'analyse
 */
function analyzeBehavior(key, endpoint = '') {
  const data = suspiciousBehavior.get(key);
  if (!data)
    return { isSuspicious: false, threatLevel: 0, detectionPoints: [] };

  let threatScore = 0;
  const results = { detectionPoints: [] };

  // Nombre de violations
  if (data.violations >= 50) {
    threatScore += 5;
    results.detectionPoints.push('high_violation_count');
  } else if (data.violations >= 10) {
    threatScore += 2;
    results.detectionPoints.push('multiple_violations');
  }

  // Distribution temporelle (détecter les modèles automatisés)
  if (data.timestamps.length >= 5) {
    const intervals = [];
    for (let i = 1; i < data.timestamps.length; i++) {
      intervals.push(data.timestamps[i] - data.timestamps[i - 1]);
    }

    // Vérifier si les intervalles sont trop réguliers (bots)
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance =
      intervals.reduce((a, b) => a + Math.pow(b - avgInterval, 2), 0) /
      intervals.length;
    const stdDev = Math.sqrt(variance);

    // Un faible écart type indique des requêtes trop régulières
    if (stdDev < avgInterval * 0.1 && intervals.length > 5) {
      threatScore += 4;
      results.detectionPoints.push('regular_pattern_detected');
    }
  }

  // Diversité des endpoints (comportement de scan)
  if (data.endpoints.size >= 10) {
    threatScore += 3;
    results.detectionPoints.push('endpoint_scanning_behavior');
  }

  // Ratio de requêtes d'erreur élevé
  if (
    data.errorRequests / Math.max(data.totalRequests, 1) > 0.5 &&
    data.totalRequests > 5
  ) {
    threatScore += 2;
    results.detectionPoints.push('high_error_rate');
  }

  // Requêtes vers des endpoints sensibles
  const sensitiveEndpoints = [
    '/api/auth/',
    '/api/register',
    '/sign-image',
    '/dashboard/',
  ];
  if (sensitiveEndpoints.some((ep) => endpoint.includes(ep))) {
    threatScore += 1;
    results.detectionPoints.push('sensitive_endpoint_access');
  }

  results.isSuspicious = threatScore >= 3;
  results.threatLevel = threatScore;
  return results;
}

/**
 * Suivre le comportement d'un client
 * @param {string} key - Clé d'identification
 * @param {Object} req - Requête
 * @param {number} violations - Nombre de violations
 * @param {boolean} isError - Si la requête a généré une erreur
 */
function trackBehavior(key, req, violations = 0, isError = false) {
  const existingData = suspiciousBehavior.get(key) || {
    timestamps: [],
    endpoints: new Set(),
    violations: 0,
    totalRequests: 0,
    errorRequests: 0,
    firstSeen: Date.now(),
    lastSeen: Date.now(),
  };

  // Mettre à jour les données
  existingData.violations += violations;
  existingData.totalRequests += 1;
  if (isError) existingData.errorRequests += 1;
  existingData.lastSeen = Date.now();
  existingData.timestamps.push(Date.now());

  // Limiter le nombre de timestamps stockés
  if (existingData.timestamps.length > 50) {
    existingData.timestamps.shift();
  }

  // Ajouter l'endpoint actuel
  const path = req.url || req.nextUrl?.pathname || '';
  if (path) {
    existingData.endpoints.add(path);
  }

  suspiciousBehavior.set(key, existingData);
}

/**
 * Middleware de rate limiting natif pour Next.js (comme integratedRateLimit.js)
 * @param {string|Object} presetOrOptions - Préréglage ou options personnalisées
 * @param {Object} additionalOptions - Options supplémentaires
 * @returns {Function} Middleware Next.js qui retourne NextResponse ou null
 */
export function applyRateLimit(
  presetOrOptions = 'PUBLIC_API',
  additionalOptions = {},
) {
  // Déterminer la configuration
  let config;
  if (typeof presetOrOptions === 'string') {
    config = {
      ...(RATE_LIMIT_PRESETS[presetOrOptions] || RATE_LIMIT_PRESETS.PUBLIC_API),
      ...additionalOptions,
    };
  } else {
    config = {
      ...RATE_LIMIT_PRESETS.PUBLIC_API,
      ...presetOrOptions,
      ...additionalOptions,
    };
  }

  // Middleware Next.js
  return async function (req) {
    const path = req.url || req.nextUrl?.pathname || '';
    const ip = extractRealIp(req);

    try {
      // 1. Vérifier si l'IP est en liste blanche
      if (IP_WHITELIST.has(ip)) {
        logger.debug('Request allowed from whitelisted IP', {
          ip: anonymizeIp(ip),
          path,
          component: 'rateLimit',
          action: 'whitelist_pass',
        });
        return null; // Autoriser sans limite
      }

      // 2. Vérifier si l'IP est bloquée
      const blockInfo = blockedIPs.get(ip);
      if (blockInfo && blockInfo.until > Date.now()) {
        const eventId = uuidv4();

        logger.warn('Request from blocked IP rejected', {
          eventId,
          ip: anonymizeIp(ip),
          path,
          component: 'rateLimit',
          until: new Date(blockInfo.until).toISOString(),
          reason: blockInfo.reason,
        });

        // Capture dans Sentry pour les blocages
        captureMessage('Request from blocked IP rejected', {
          level: 'warning',
          tags: {
            component: 'rateLimit',
            action: 'blocked_ip_rejection',
          },
          extra: {
            eventId,
            ip: anonymizeIp(ip),
            path,
            blockReason: blockInfo.reason,
            blockUntil: new Date(blockInfo.until).toISOString(),
          },
        });

        // Créer et retourner la réponse d'erreur
        return NextResponse.json(
          {
            status: 429,
            error: 'Too Many Requests',
            message: blockInfo.message || config.message,
            retryAfter: Math.ceil((blockInfo.until - Date.now()) / 1000),
            reference: eventId,
          },
          {
            status: 429,
            headers: {
              'Retry-After': Math.ceil(
                (blockInfo.until - Date.now()) / 1000,
              ).toString(),
            },
          },
        );
      }

      // 3. Gérer le skip (bypass) si nécessaire
      if (
        additionalOptions.skip &&
        typeof additionalOptions.skip === 'function'
      ) {
        if (additionalOptions.skip(req)) {
          logger.debug('Request skipped by custom skip function', {
            ip: anonymizeIp(ip),
            path,
            component: 'rateLimit',
            action: 'custom_skip',
          });
          return null; // Skip le rate limiting
        }
      }

      // 4. Générer une clé unique pour cette requête
      const key = generateKey(
        req,
        additionalOptions.prefix ||
          (typeof presetOrOptions === 'string' ? presetOrOptions : 'custom'),
      );

      // 5. Récupérer les données de requête existantes
      const now = Date.now();
      const windowStart = now - config.windowMs;
      let requestData = requestCache.get(key) || {
        requests: [],
        successCount: 0,
        errorCount: 0,
      };

      // Supprimer les requêtes trop anciennes (hors de la fenêtre)
      requestData.requests = requestData.requests.filter(
        (timestamp) => timestamp > windowStart,
      );

      // 6. Vérifier si la limite est dépassée
      const currentRequests = requestData.requests.length;

      if (currentRequests >= config.max) {
        // Limite dépassée, analyser le comportement
        trackBehavior(key, req, 1, false);
        const behavior = analyzeBehavior(key, path);

        // Déterminer le niveau de violation
        const violationRatio = currentRequests / config.max;
        let violationLevel = VIOLATION_LEVELS.LOW;

        for (const level of Object.values(VIOLATION_LEVELS)) {
          if (violationRatio >= level.threshold) {
            violationLevel = level;
          }
        }

        // Calculer la durée du blocage supplémentaire
        let blockDuration = violationLevel.blockDuration;
        if (behavior.isSuspicious) {
          // Augmenter la durée pour les comportements suspects
          blockDuration *= 1 + Math.min(behavior.threatLevel, 10) / 5;
        }

        // Calculer la date de fin du blocage
        const resetTime = Math.max(...requestData.requests) + config.windowMs;
        const blockUntil = blockDuration > 0 ? now + blockDuration : resetTime;

        // Générer un ID d'événement pour le suivi
        const eventId = uuidv4();

        // Logger la violation avec Winston
        const logData = {
          eventId,
          ip: anonymizeIp(ip),
          path,
          component: 'rateLimit',
          userAgent:
            req.headers?.get?.('user-agent')?.substring(0, 100) || 'unknown',
          requests: currentRequests,
          limit: config.max,
          violationRatio: parseFloat(violationRatio.toFixed(2)),
          violationLevel: violationLevel.severity,
          blockDuration: `${Math.round(blockDuration / 1000)}s`,
          suspicious: behavior.isSuspicious,
          threatLevel: behavior.threatLevel,
          detectionPoints: behavior.detectionPoints,
        };

        logger[violationLevel.logLevel]('Rate limit exceeded', logData);

        // Envoyer à Sentry pour les violations plus graves
        if (violationLevel.severity !== 'low') {
          captureMessage(
            `Rate limit violation detected: ${violationLevel.severity}`,
            {
              level: violationLevel.sentryLevel,
              tags: {
                component: 'rateLimit',
                violationLevel: violationLevel.severity,
                suspicious: behavior.isSuspicious.toString(),
                error_category: 'rate_limiting',
              },
              extra: {
                eventId,
                ip: anonymizeIp(ip),
                path,
                requests: currentRequests,
                limit: config.max,
                violationRatio,
                blockDuration,
                detectionPoints: behavior.detectionPoints,
                threatLevel: behavior.threatLevel,
                preset:
                  typeof presetOrOptions === 'string'
                    ? presetOrOptions
                    : 'custom',
              },
            },
          );
        }

        // Bloquer les IPs pour les violations graves
        if (violationLevel.severity === 'severe' && behavior.threatLevel >= 8) {
          blockedIPs.set(ip, {
            until: now + 24 * 60 * 60 * 1000, // 24 heures
            reason: 'Severe violation with suspicious behavior',
            message:
              'Limite de requêtes largement dépassée. Votre accès est temporairement restreint.',
          });

          logger.error(
            'Added IP to temporary blacklist due to severe violations',
            {
              ip: anonymizeIp(ip),
              eventId,
              component: 'rateLimit',
              action: 'blacklist_add',
              reason: 'severe_violation_with_suspicious_behavior',
            },
          );

          captureMessage('IP blacklisted due to severe rate limit violations', {
            level: 'error',
            tags: {
              component: 'rateLimit',
              action: 'blacklist_add',
              error_category: 'rate_limiting',
            },
            extra: {
              eventId,
              ip: anonymizeIp(ip),
              threatLevel: behavior.threatLevel,
              detectionPoints: behavior.detectionPoints,
              violationLevel: violationLevel.severity,
            },
          });
        }

        // Calculer le temps avant réinitialisation
        const retryAfter = Math.ceil((blockUntil - now) / 1000);

        // Message personnalisé selon la gravité
        let message =
          config.message || 'Trop de requêtes, veuillez réessayer plus tard';
        if (
          violationLevel.severity === 'high' ||
          violationLevel.severity === 'severe'
        ) {
          message =
            'Limite de requêtes largement dépassée. Votre accès est temporairement restreint.';
        }

        // Créer et retourner la réponse NextResponse
        return NextResponse.json(
          {
            status: 429,
            error: 'Too Many Requests',
            message,
            retryAfter,
            reference: eventId,
          },
          {
            status: 429,
            headers: {
              'Retry-After': retryAfter.toString(),
              'X-RateLimit-Limit': config.max.toString(),
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': Math.ceil(blockUntil / 1000).toString(),
            },
          },
        );
      }

      // 7. Si la limite n'est pas dépassée, enregistrer cette requête
      requestData.requests.push(now);
      requestCache.set(key, requestData);

      // 8. Mettre à jour le suivi du comportement (sans violation)
      trackBehavior(key, req, 0, false);

      // 9. Log du succès pour le debug
      logger.debug('Request allowed within rate limits', {
        ip: anonymizeIp(ip),
        path,
        component: 'rateLimit',
        currentRequests: currentRequests + 1,
        limit: config.max,
        remaining: Math.max(0, config.max - currentRequests - 1),
      });

      // 10. Laisser passer la requête
      return null;
    } catch (error) {
      // Classification et logging de l'erreur
      const errorCategory = categorizeRateLimitError(error);

      logger.error('Unexpected error in rate limit middleware', {
        error: error.message,
        stack: error.stack,
        path,
        component: 'rateLimit',
        errorCategory,
        ip: anonymizeIp(ip),
      });

      // Capture d'exception avec Sentry
      captureException(error, {
        level: 'error',
        tags: {
          component: 'rateLimit',
          error_category: errorCategory,
          type: 'critical_middleware_failure',
        },
        extra: {
          path,
          preset:
            typeof presetOrOptions === 'string' ? presetOrOptions : 'custom',
          ip: anonymizeIp(ip),
        },
      });

      // En cas d'erreur, laisser passer la requête (fail open)
      return null;
    }
  };
}

/**
 * Fonction utilitaire pour les cas simples (compatibilité descendante)
 * @param {string|Object} presetOrOptions - Préréglage ou options personnalisées
 * @param {Object} additionalOptions - Options supplémentaires
 * @returns {Function} Fonction de rate limiting qui retourne un objet de statut
 */
export function limitRequest(
  presetOrOptions = 'PUBLIC_API',
  additionalOptions = {},
) {
  // Utiliser applyRateLimit en interne mais retourner un objet de statut
  const rateLimitMiddleware = applyRateLimit(
    presetOrOptions,
    additionalOptions,
  );

  return function checkRateLimit(req, options = {}) {
    // Exécuter le middleware de rate limiting
    const response = rateLimitMiddleware(req);

    if (response === null) {
      // Aucune limitation, autoriser
      return {
        allowed: true,
        reason: 'success',
        headers: {
          'X-RateLimit-Limit': (
            RATE_LIMIT_PRESETS[presetOrOptions] || RATE_LIMIT_PRESETS.PUBLIC_API
          ).max.toString(),
          'X-RateLimit-Remaining': 'calculated',
          'X-RateLimit-Reset': Math.ceil(
            (Date.now() +
              (
                RATE_LIMIT_PRESETS[presetOrOptions] ||
                RATE_LIMIT_PRESETS.PUBLIC_API
              ).windowMs) /
              1000,
          ).toString(),
        },
      };
    } else if (response instanceof Promise) {
      // Le middleware est async, attendre le résultat
      return response.then((result) => {
        if (result === null) {
          return { allowed: true, reason: 'success' };
        } else {
          // Extraire les informations de la NextResponse
          return {
            allowed: false,
            reason: 'rate_limited',
            message: 'Rate limit exceeded',
            // Note: Les headers et autres détails sont dans la NextResponse
          };
        }
      });
    } else {
      // Rate limit dépassé, NextResponse retournée
      return {
        allowed: false,
        reason: 'rate_limited',
        message: 'Rate limit exceeded',
        // Note: Les headers et autres détails sont dans la NextResponse
      };
    }
  };
}

/**
 * Ajoute une IP à la liste blanche (exemptée de rate limiting)
 * @param {string} ip Adresse IP à ajouter
 */
export function addToWhitelist(ip) {
  IP_WHITELIST.add(ip);

  logger.info('Added IP to rate limit whitelist', {
    ip: anonymizeIp(ip),
    component: 'rateLimit',
    action: 'whitelist_add',
  });

  captureMessage('IP added to rate limit whitelist', {
    level: 'info',
    tags: {
      component: 'rateLimit',
      action: 'whitelist_add',
    },
    extra: {
      ip: anonymizeIp(ip),
    },
  });
}

/**
 * Ajoute une IP à la liste noire (toujours bloquée)
 * @param {string} ip Adresse IP à bloquer
 * @param {number} duration Durée du blocage en ms (0 = permanent)
 */
export function addToBlacklist(ip, duration = 0) {
  const now = Date.now();
  const until = duration > 0 ? now + duration : Number.MAX_SAFE_INTEGER;

  blockedIPs.set(ip, {
    until,
    reason: 'Manually blacklisted',
    message: 'Votre accès a été temporairement restreint.',
  });

  const logData = {
    ip: anonymizeIp(ip),
    component: 'rateLimit',
    action: 'blacklist_add',
    duration: duration ? `${duration / 1000}s` : 'permanent',
    until: new Date(until).toISOString(),
  };

  logger.info('Added IP to rate limit blacklist', logData);

  // Envoyer une alerte Sentry pour la mise en liste noire manuelle
  captureMessage('IP manually blacklisted in rate limiter', {
    level: 'warning',
    tags: {
      component: 'rateLimit',
      action: 'manual_blacklist',
    },
    extra: {
      ip: anonymizeIp(ip),
      duration: duration ? `${duration / 1000}s` : 'permanent',
      until: new Date(until).toISOString(),
    },
  });
}

/**
 * Réinitialise toutes les données de comportement et limites
 * pour le diagnostic ou le nettoyage
 */
export function resetAllData() {
  const beforeStats = {
    requestCache: requestCache.size,
    blockedIPs: blockedIPs.size,
    suspiciousBehavior: suspiciousBehavior.size,
  };

  requestCache.clear();
  blockedIPs.clear();
  suspiciousBehavior.clear();

  logger.info('Reset all rate limit behavior tracking data', {
    component: 'rateLimit',
    action: 'reset_all',
    beforeStats,
  });

  captureMessage('Rate limit data reset', {
    level: 'info',
    tags: {
      component: 'rateLimit',
      action: 'reset_all',
    },
    extra: {
      beforeStats,
    },
  });
}

/**
 * Obtenir des statistiques sur l'utilisation du rate limiting
 * @returns {Object} Statistiques d'utilisation
 */
export function getRateLimitStats() {
  const stats = {
    activeKeys: requestCache.size,
    suspiciousBehaviors: suspiciousBehavior.size,
    blockedIPs: blockedIPs.size,
    whitelistedIPs: IP_WHITELIST.size,
    memoryUsage: {
      requests: requestCache.size,
      blocked: blockedIPs.size,
      suspicious: suspiciousBehavior.size,
    },
    timestamp: new Date().toISOString(),
  };

  logger.info('Rate limit statistics', {
    component: 'rateLimit',
    action: 'stats',
    ...stats,
  });

  return stats;
}

// Nettoyage périodique (optionnel pour les environnements serverless)
if (
  typeof setInterval !== 'undefined' &&
  process.env.NODE_ENV !== 'production'
) {
  // Nettoyage des entrées expirées (toutes les 5 minutes en développement)
  const cleanupInterval = setInterval(
    () => {
      try {
        const now = Date.now();
        let cleaned = 0;

        // Nettoyer les IPs bloquées expirées
        for (const [ip, blockInfo] of blockedIPs.entries()) {
          if (blockInfo.until <= now) {
            blockedIPs.delete(ip);
            cleaned++;
          }
        }

        // Nettoyer les données de comportement trop anciennes (24 heures)
        for (const [key, data] of suspiciousBehavior.entries()) {
          if (now - data.lastSeen > 24 * 60 * 60 * 1000) {
            suspiciousBehavior.delete(key);
            cleaned++;
          }
        }

        // Nettoyer le cache de requêtes (garder seulement les 10000 plus récentes)
        if (requestCache.size > 10000) {
          const keys = Array.from(requestCache.keys());
          const keysToRemove = keys.slice(0, keys.length - 10000);
          keysToRemove.forEach((key) => requestCache.delete(key));
          cleaned += keysToRemove.length;
        }

        if (cleaned > 0) {
          logger.info('Periodic cleanup completed', {
            component: 'rateLimit',
            action: 'periodic_cleanup',
            itemsCleaned: cleaned,
            remainingItems: {
              requests: requestCache.size,
              blocked: blockedIPs.size,
              suspicious: suspiciousBehavior.size,
            },
          });
        }
      } catch (error) {
        logger.error('Error during rate limit cleanup', {
          error: error.message,
          stack: error.stack,
          component: 'rateLimit',
          action: 'cleanup_error',
        });

        captureException(error, {
          level: 'error',
          tags: {
            component: 'rateLimit',
            action: 'cleanup_error',
            error_category: 'rate_limiting',
          },
          extra: {
            cachesSizes: {
              requests: requestCache.size,
              blocked: blockedIPs.size,
              suspicious: suspiciousBehavior.size,
            },
          },
        });
      }
    },
    5 * 60 * 1000,
  );

  // Éviter de bloquer la fermeture du processus
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  // Rapports statistiques périodiques (toutes les heures en développement)
  const statsInterval = setInterval(
    () => {
      const stats = getRateLimitStats();

      captureMessage('Rate limit statistics (hourly)', {
        level: 'info',
        tags: {
          component: 'rateLimit',
          action: 'stats_reporting',
        },
        extra: stats,
      });
    },
    60 * 60 * 1000,
  );

  // Éviter de bloquer la fermeture du processus Node.js
  if (statsInterval.unref) {
    statsInterval.unref();
  }
}

/**
 * Capture les erreurs de rate limiting avec contexte spécifique
 * @param {Error} error - L'erreur de rate limiting
 * @param {Object} context - Contexte de la requête
 */
export const captureRateLimitError = (error, context = {}) => {
  const rateLimitContext = {
    tags: {
      error_category: 'rate_limiting',
      component: 'rateLimit',
      ...context.tags,
    },
    extra: {
      preset: context.preset || 'unknown',
      violationLevel: context.violationLevel || 'unknown',
      ip: context.ip ? anonymizeIp(context.ip) : 'unknown',
      endpoint: context.endpoint || 'unknown',
      ...context.extra,
    },
    level: 'warning',
  };

  // Filtrer les informations sensibles du rate limiting
  if (rateLimitContext.extra.requestData) {
    // Masquer les détails de requête potentiellement sensibles
    rateLimitContext.extra.requestData = '[Filtered Request Data]';
  }

  captureException(error, rateLimitContext);
};

/**
 * Capture les événements de rate limiting avec contexte spécifique
 * @param {string} message - Le message à capturer
 * @param {Object} context - Contexte de l'événement
 */
export const captureRateLimitEvent = (message, context = {}) => {
  const rateLimitContext = {
    tags: {
      component: 'rateLimit',
      action: context.action || 'unknown',
      ...context.tags,
    },
    extra: {
      preset: context.preset || 'unknown',
      ip: context.ip ? anonymizeIp(context.ip) : 'unknown',
      endpoint: context.endpoint || 'unknown',
      ...context.extra,
    },
    level: context.level || 'info',
  };

  captureMessage(message, rateLimitContext);
};

// Export par défaut pour la compatibilité
export default {
  applyRateLimit, // Fonction principale comme integratedRateLimit.js
  limitRequest, // Fonction utilitaire pour compatibilité
  addToWhitelist,
  addToBlacklist,
  resetAllData,
  getRateLimitStats,
  captureRateLimitError,
  captureRateLimitEvent,
  RATE_LIMIT_PRESETS,
  VIOLATION_LEVELS,
};
