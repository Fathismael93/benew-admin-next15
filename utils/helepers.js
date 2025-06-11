// utils/helpers.js
// Fonctions utilitaires centralisées pour le monitoring et la sécurité

/**
 * Fonction pour détecter les données sensibles spécifiques au dashboard admin
 * @param {string} str - La chaîne à analyser
 * @returns {boolean} - True si des données sensibles sont détectées
 */
export function containsSensitiveData(str) {
  if (!str || typeof str !== 'string') return false;

  // Patterns pour détecter les données sensibles spécifiques à votre application
  const patterns = [
    // Authentification et tokens
    /password/i,
    /mot\s*de\s*passe/i,
    /nextauth[_-]?secret/i,
    /jwt[_-]?token/i,
    /access[_-]?token/i,
    /refresh[_-]?token/i,
    /session[_-]?token/i,

    // API Keys et secrets
    /api[_-]?key/i,
    /secret[_-]?key/i,
    /cloudinary[_-]?api[_-]?secret/i,
    /db[_-]?password/i,
    /database[_-]?password/i,
    /sentry[_-]?auth[_-]?token/i,

    // Données bancaires et paiement
    /credit\s*card/i,
    /carte\s*de\s*credit/i,
    /payment[_-]?method/i,
    /card[_-]?number/i,
    /cvv/i,
    /expiry/i,

    // Numéros sensibles
    /\b(?:\d{4}[ -]?){3}\d{4}\b/, // Numéros de carte
    /\b(?:\d{3}[ -]?){2}\d{4}\b/, // Numéros de téléphone
    /\b\d{3}[ -]?\d{2}[ -]?\d{4}\b/, // SSN

    // Données utilisateurs sensibles
    /user[_-]?password/i,
    /email[_-]?verification/i,
    /reset[_-]?token/i,
    /verification[_-]?code/i,

    // Données spécifiques au projet
    /platform[_-]?number/i, // Numéros de plateforme de paiement
    /application[_-]?price/i,
    /order[_-]?payment/i,
  ];

  return patterns.some((pattern) => pattern.test(str));
}

/**
 * Classification des erreurs par catégorie pour votre application dashboard
 * @param {Error} error - L'erreur à classifier
 * @returns {string} - Catégorie de l'erreur
 */
export function categorizeError(error) {
  if (!error) return 'unknown';

  const message = error.message || '';
  const name = error.name || '';
  const stack = error.stack || '';
  const combinedText = (message + name + stack).toLowerCase();

  // Erreurs de base de données PostgreSQL
  if (/postgres|pg|database|db|connection|timeout|pool/i.test(combinedText)) {
    return 'database';
  }

  // Erreurs d'authentification NextAuth
  if (
    /nextauth|auth|permission|token|unauthorized|forbidden|session/i.test(
      combinedText,
    )
  ) {
    return 'authentication';
  }

  // Erreurs Cloudinary
  if (/cloudinary|image|upload|transform|media/i.test(combinedText)) {
    return 'media_upload';
  }

  // Erreurs API et réseau
  if (/network|fetch|http|request|response|api/i.test(combinedText)) {
    return 'network';
  }

  // Erreurs de validation Yup
  if (/validation|schema|required|invalid|yup/i.test(combinedText)) {
    return 'validation';
  }

  // Erreurs TipTap Editor
  if (/tiptap|editor|prosemirror/i.test(combinedText)) {
    return 'editor';
  }

  // Erreurs spécifiques aux entités métier
  if (
    /template|application|article|blog|platform|order|user/i.test(combinedText)
  ) {
    return 'business_logic';
  }

  // Erreurs de rate limiting
  if (/rate.?limit|too.?many.?requests|429/i.test(combinedText)) {
    return 'rate_limiting';
  }

  return 'application';
}

/**
 * Fonction centralisée pour anonymiser les données utilisateur du dashboard
 * @param {Object} userData - Données utilisateur à anonymiser
 * @returns {Object} - Données utilisateur anonymisées
 */
export function anonymizeUserData(userData) {
  if (!userData) return userData;

  const anonymizedData = { ...userData };

  // Supprimer les informations très sensibles
  delete anonymizedData.ip_address;
  delete anonymizedData.user_password;
  delete anonymizedData.session_token;

  // Anonymiser le nom d'utilisateur
  if (anonymizedData.username || anonymizedData.user_name) {
    const username = anonymizedData.username || anonymizedData.user_name;
    anonymizedData.username =
      username.length > 2
        ? username[0] + '***' + username.slice(-1)
        : '[USERNAME]';
    delete anonymizedData.user_name;
  }

  // Anonymiser l'email
  if (anonymizedData.email || anonymizedData.user_email) {
    const email = anonymizedData.email || anonymizedData.user_email;
    const atIndex = email.indexOf('@');
    if (atIndex > 0) {
      const domain = email.slice(atIndex);
      anonymizedData.email = `${email[0]}***${domain}`;
    } else {
      anonymizedData.email = '[FILTERED_EMAIL]';
    }
    delete anonymizedData.user_email;
  }

  // Anonymiser l'ID utilisateur
  if (anonymizedData.id || anonymizedData.user_id) {
    const id = String(anonymizedData.id || anonymizedData.user_id);
    anonymizedData.id =
      id.length > 2 ? id.substring(0, 1) + '***' + id.slice(-1) : '[USER_ID]';
    delete anonymizedData.user_id;
  }

  // Anonymiser le téléphone
  if (anonymizedData.phone || anonymizedData.user_phone) {
    const phone = anonymizedData.phone || anonymizedData.user_phone;
    anonymizedData.phone =
      phone.length > 4
        ? phone.substring(0, 2) + '***' + phone.slice(-2)
        : '[PHONE]';
    delete anonymizedData.user_phone;
  }

  return anonymizedData;
}

/**
 * Fonction centralisée pour anonymiser les URLs spécifiques au dashboard
 * @param {string} url - URL à anonymiser
 * @returns {string} - URL anonymisée
 */
export function anonymizeUrl(url) {
  if (!url) return url;

  try {
    const urlObj = new URL(url);

    // Paramètres sensibles spécifiques à votre application
    const sensitiveParams = [
      'token',
      'password',
      'accessToken',
      'refreshToken',
      'sessionToken',
      'key',
      'secret',
      'auth',
      'api_key',
      'apikey',
      'pass',
      'pwd',
      'credential',
      'nextauth_secret',
      'cloudinary_secret',
      'sentry_token',
      'db_password',
      'verification_code',
      'reset_token',
    ];

    let hasFilteredParams = false;
    sensitiveParams.forEach((param) => {
      if (urlObj.searchParams.has(param)) {
        urlObj.searchParams.set(param, '[FILTERED]');
        hasFilteredParams = true;
      }
    });

    // Masquer les IDs dans les URLs pour protéger l'identité
    const pathSegments = urlObj.pathname.split('/');
    const maskedSegments = pathSegments.map((segment, index) => {
      // Si c'est un ID numérique, le masquer partiellement
      if (/^\d+$/.test(segment) && segment.length > 2) {
        return segment.substring(0, 1) + '***' + segment.slice(-1);
      }
      return segment;
    });

    if (maskedSegments.join('/') !== urlObj.pathname) {
      urlObj.pathname = maskedSegments.join('/');
      hasFilteredParams = true;
    }

    return hasFilteredParams ? urlObj.toString() : url;
  } catch (e) {
    // En cas d'erreur de parsing, retourner une version sécurisée
    return '[URL_PARSING_ERROR]';
  }
}

/**
 * Fonction centralisée pour anonymiser les headers
 * @param {Object} headers - Headers à anonymiser
 * @returns {Object} - Headers anonymisés
 */
export function anonymizeHeaders(headers) {
  if (!headers) return headers;

  const sanitizedHeaders = { ...headers };

  // Headers sensibles spécifiques à votre stack
  const sensitiveHeaders = [
    'cookie',
    'authorization',
    'x-auth-token',
    'x-session-token',
    'session',
    'x-api-key',
    'token',
    'auth',
    'nextauth.session-token',
    'cloudinary-auth',
    'x-csrf-token',
    'x-forwarded-for', // IP potentiellement sensible
  ];

  sensitiveHeaders.forEach((header) => {
    const lowerHeader = header.toLowerCase();
    Object.keys(sanitizedHeaders).forEach((key) => {
      if (key.toLowerCase() === lowerHeader) {
        sanitizedHeaders[key] = '[FILTERED]';
      }
    });
  });

  return sanitizedHeaders;
}

/**
 * Fonction centralisée pour filtrer le corps des requêtes
 * @param {string|Object} body - Corps de requête à filtrer
 * @returns {string|Object} - Corps de requête filtré
 */
export function filterRequestBody(body) {
  if (!body) return body;

  if (containsSensitiveData(body)) {
    try {
      if (typeof body === 'string') {
        const parsedBody = JSON.parse(body);

        // Spécifiquement filtrer les champs sensibles de votre application
        const sensitiveFields = [
          'password',
          'confirmPassword',
          'user_password',
          'api_key',
          'secret',
          'token',
          'auth',
          'cloudinary_secret',
          'db_password',
          'platform_number',
          'payment_info',
          'card_number',
          'cvv',
          'expiry',
        ];

        const filteredBody = { ...parsedBody };
        sensitiveFields.forEach((field) => {
          if (filteredBody[field]) {
            filteredBody[field] = '[FILTERED]';
          }
        });

        return {
          filtered: '[CONTIENT DES DONNÉES SENSIBLES]',
          bodySize: JSON.stringify(parsedBody).length,
          sanitizedPreview:
            JSON.stringify(filteredBody).substring(0, 200) + '...',
        };
      }
    } catch (e) {
      // Parsing JSON échoué
    }
    return '[DONNÉES FILTRÉES]';
  }

  return body;
}

/**
 * Génère un ID de requête unique pour le traçage
 * @returns {string} - ID unique
 */
export function generateRequestId() {
  return Math.random().toString(36).substring(2, 15);
}

/**
 * Extrait l'IP réelle d'une requête en gérant les proxies
 * @param {Request} req - Requête HTTP
 * @returns {string} - IP du client
 */
export function extractRealIp(req) {
  const forwardedFor = req.headers.get('x-forwarded-for');
  const realIp = req.headers.get('x-real-ip');
  const cfConnectingIp = req.headers.get('cf-connecting-ip');

  if (cfConnectingIp) {
    return cfConnectingIp;
  } else if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  } else if (realIp) {
    return realIp;
  }

  return '0.0.0.0';
}

/**
 * Anonymise une adresse IP pour les logs
 * @param {string} ip - Adresse IP à anonymiser
 * @returns {string} - IP anonymisée
 */
export function anonymizeIp(ip) {
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
