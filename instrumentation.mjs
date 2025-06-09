/* eslint-disable no-unused-vars */
// instrumentation.mjs - Version simplifiée pour éviter les erreurs de build

// ----- FONCTIONS UTILITAIRES SEULEMENT -----

// Fonction pour détecter les données sensibles
export function containsSensitiveData(str) {
  if (!str || typeof str !== 'string') return false;

  const patterns = [
    /password/i,
    /mot\s*de\s*passe/i,
    /nextauth[_-]?secret/i,
    /jwt[_-]?token/i,
    /access[_-]?token/i,
    /refresh[_-]?token/i,
    /session[_-]?token/i,
    /api[_-]?key/i,
    /secret[_-]?key/i,
    /cloudinary[_-]?api[_-]?secret/i,
    /db[_-]?password/i,
    /database[_-]?password/i,
    /sentry[_-]?auth[_-]?token/i,
    /credit\s*card/i,
    /carte\s*de\s*credit/i,
    /payment[_-]?method/i,
    /card[_-]?number/i,
    /cvv/i,
    /expiry/i,
    /\b(?:\d{4}[ -]?){3}\d{4}\b/,
    /\b(?:\d{3}[ -]?){2}\d{4}\b/,
    /\b\d{3}[ -]?\d{2}[ -]?\d{4}\b/,
    /user[_-]?password/i,
    /email[_-]?verification/i,
    /reset[_-]?token/i,
    /verification[_-]?code/i,
    /platform[_-]?number/i,
    /application[_-]?price/i,
    /order[_-]?payment/i,
  ];

  return patterns.some((pattern) => pattern.test(str));
}

// Classification des erreurs
export function categorizeError(error) {
  if (!error) return 'unknown';

  const message = error.message || '';
  const name = error.name || '';
  const stack = error.stack || '';
  const combinedText = (message + name + stack).toLowerCase();

  if (/postgres|pg|database|db|connection|timeout|pool/i.test(combinedText)) {
    return 'database';
  }

  if (
    /nextauth|auth|permission|token|unauthorized|forbidden|session/i.test(
      combinedText,
    )
  ) {
    return 'authentication';
  }

  if (/cloudinary|image|upload|transform|media/i.test(combinedText)) {
    return 'media_upload';
  }

  if (/network|fetch|http|request|response|api|axios/i.test(combinedText)) {
    return 'network';
  }

  if (/validation|schema|required|invalid|yup/i.test(combinedText)) {
    return 'validation';
  }

  if (/tiptap|editor|prosemirror/i.test(combinedText)) {
    return 'editor';
  }

  if (
    /template|application|article|blog|platform|order|user/i.test(combinedText)
  ) {
    return 'business_logic';
  }

  if (/rate.?limit|too.?many.?requests|429/i.test(combinedText)) {
    return 'rate_limiting';
  }

  return 'application';
}

// Anonymisation des données utilisateur
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

// Anonymisation des headers
export function anonymizeHeaders(headers) {
  if (!headers) return headers;

  const sanitizedHeaders = { ...headers };
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
    'x-forwarded-for',
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

// Anonymisation des URLs
export function anonymizeUrl(url) {
  if (!url) return url;

  try {
    const urlObj = new URL(url);
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

    const pathSegments = urlObj.pathname.split('/');
    const maskedSegments = pathSegments.map((segment) => {
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
    return '[URL_PARSING_ERROR]';
  }
}

// Filtrage du corps des requêtes
export function filterRequestBody(body) {
  if (!body) return body;

  if (containsSensitiveData(body)) {
    try {
      if (typeof body === 'string') {
        const parsedBody = JSON.parse(body);
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

// Fonctions Sentry simplifiées avec fallback
export async function captureException(error, options = {}) {
  // Fallback simple en cas d'erreur Sentry
  console.error('Exception captured:', {
    message: error.message,
    name: error.name,
    category: categorizeError(error),
    ...options,
  });
}

export async function setContext(key, context) {
  // Fallback simple
  console.log(`Context [${key}]:`, context);
}

export async function setUser(user) {
  // Fallback simple
  console.log('User context:', anonymizeUserData(user));
}

export async function addBreadcrumb(breadcrumb) {
  // Fallback simple
  console.log('Breadcrumb:', breadcrumb);
}

// Fonction register simplifiée - PAS D'INITIALISATION SENTRY POUR ÉVITER LES ERREURS
export async function register() {
  const environment = process.env.NODE_ENV || 'development';
  console.log(`📊 Instrumentation loaded for ${environment} environment`);

  // Ne pas initialiser Sentry pour éviter les conflits
  console.log('ℹ️ Sentry initialization skipped to prevent build errors');
}

// Pas d'instrumentation de requête pour éviter les erreurs
export async function onRequestError({ error, request }) {
  console.error('Request error:', {
    url: request.url,
    method: request.method,
    error: error.message,
    category: categorizeError(error),
  });
}
