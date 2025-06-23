// ===== FICHIER: utils/sanitizers/sanitizePlatformInputs.js =====

/**
 * Sanitize les données du formulaire d'ajout de plateforme
 * @param {Object} formData - Les données du formulaire à sanitizer
 * @returns {Object} - Les données sanitizées
 */
export const sanitizePlatformInputs = (formData) => {
  // Fonction pour sanitizer le nom de la plateforme
  const sanitizePlatformName = (platformName) => {
    if (typeof platformName !== 'string') return platformName;

    return (
      platformName
        // Garde seulement les caractères autorisés (lettres, chiffres, espaces, ., _, -)
        .replace(/[^a-zA-Z0-9._\s-]/g, '')
        // Supprime les espaces multiples
        .replace(/\s+/g, ' ')
        .trim()
    );
  };

  // Fonction pour sanitizer le numéro de plateforme (téléphone ou code)
  const sanitizePlatformNumber = (platformNumber) => {
    if (typeof platformNumber !== 'string') return platformNumber;

    return (
      platformNumber
        // Garde les caractères valides pour un numéro de téléphone ou code
        // Téléphone: chiffres, +, (, ), -, espaces, .
        // Code: lettres, chiffres, _, -, .
        .replace(/[^a-zA-Z0-9+\-\s().]/g, '')
        // Supprime les espaces multiples
        .replace(/\s+/g, ' ')
        .trim()
    );
  };

  // Application de la sanitization à chaque champ
  const sanitizedData = {
    platformName: sanitizePlatformName(formData.platformName || ''),
    platformNumber: sanitizePlatformNumber(formData.platformNumber || ''),
  };

  // Logs pour le debugging (à supprimer en production)
  if (process.env.NODE_ENV === 'development') {
    const changedFields = [];
    Object.keys(sanitizedData).forEach((key) => {
      if (formData[key] !== sanitizedData[key]) {
        changedFields.push(key);
      }
    });

    if (changedFields.length > 0) {
      console.warn('Champs sanitizés (platform):', changedFields);
    }
  }

  return sanitizedData;
};

/**
 * Version alternative plus stricte avec validation supplémentaire
 * @param {Object} formData - Les données du formulaire à sanitizer
 * @returns {Object} - Les données sanitizées avec des vérifications supplémentaires
 */
export const sanitizePlatformInputsStrict = (formData) => {
  const basicSanitized = sanitizePlatformInputs(formData);

  // Vérifications supplémentaires
  const strictSanitized = {
    ...basicSanitized,

    // Limite la longueur des champs pour éviter les attaques par déni de service
    platformName: basicSanitized.platformName.slice(0, 50), // Limite raisonnable pour un nom de plateforme
    platformNumber: basicSanitized.platformNumber.slice(0, 50), // Limite pour un numéro/code de plateforme
  };

  // Vérification additionnelle pour détecter des tentatives d'injection
  const suspiciousPatterns = [
    /<script/i,
    /javascript:/i,
    /vbscript:/i,
    /on\w+\s*=/i,
    /data:text\/html/i,
    /\.\.\//i, // Path traversal
    /\0/g, // Null bytes
    /union\s+select/i, // SQL injection basique
    /drop\s+table/i, // SQL injection
    /';\s*--/i, // Commentaire SQL
  ];

  Object.entries(strictSanitized).forEach(([key, value]) => {
    if (typeof value === 'string') {
      suspiciousPatterns.forEach((pattern) => {
        if (pattern.test(value)) {
          console.warn(
            `Contenu suspect détecté dans le champ ${key} (platform)`,
          );
          // En production, vous pourriez vouloir logger cet événement
        }
      });
    }
  });

  return strictSanitized;
};

/**
 * Fonction utilitaire spécialisée pour nettoyer un numéro de téléphone
 * @param {string} phoneNumber - Le numéro de téléphone à nettoyer
 * @returns {string} - Le numéro nettoyé
 */
export const sanitizePhoneNumber = (phoneNumber) => {
  if (typeof phoneNumber !== 'string') return phoneNumber;

  return (
    phoneNumber
      // Garde seulement les caractères valides pour un téléphone
      .replace(/[^0-9+\-\s().]/g, '')
      // Supprime les espaces multiples
      .replace(/\s+/g, ' ')
      .trim()
  );
};

/**
 * Fonction utilitaire spécialisée pour nettoyer un code de plateforme
 * @param {string} platformCode - Le code de plateforme à nettoyer
 * @returns {string} - Le code nettoyé
 */
export const sanitizePlatformCode = (platformCode) => {
  if (typeof platformCode !== 'string') return platformCode;

  return (
    platformCode
      // Garde seulement les caractères valides pour un code
      .replace(/[^a-zA-Z0-9._-]/g, '')
      .trim()
  );
};

/**
 * Fonction utilitaire pour détecter et sanitizer automatiquement selon le type
 * @param {string} platformNumber - Le numéro à sanitizer
 * @returns {Object} - Objet avec le numéro sanitisé et son type détecté
 */
export const smartSanitizePlatformNumber = (platformNumber) => {
  if (typeof platformNumber !== 'string') {
    return {
      sanitized: platformNumber,
      type: 'invalid',
    };
  }

  const cleaned = platformNumber.trim();

  // Détecter si c'est probablement un numéro de téléphone
  if (/[0-9+\-\s().]/.test(cleaned) && /\d/.test(cleaned)) {
    return {
      sanitized: sanitizePhoneNumber(cleaned),
      type: 'phone',
    };
  }

  // Sinon, traiter comme un code
  return {
    sanitized: sanitizePlatformCode(cleaned),
    type: 'code',
  };
};

/**
 * Fonction de validation des données sanitizées
 * @param {Object} sanitizedData - Les données sanitizées à valider
 * @returns {Object} - Objet avec isValid et errors
 */
export const validateSanitizedPlatformData = (sanitizedData) => {
  const errors = [];

  // Validation du nom de plateforme
  if (!sanitizedData.platformName || sanitizedData.platformName.length < 3) {
    errors.push(
      'Platform name must be at least 3 characters after sanitization',
    );
  }

  // Validation du numéro de plateforme
  if (
    !sanitizedData.platformNumber ||
    sanitizedData.platformNumber.length < 3
  ) {
    errors.push(
      'Platform number must be at least 3 characters after sanitization',
    );
  }

  // Vérifier que le numéro contient au moins un caractère alphanumérique
  if (
    sanitizedData.platformNumber &&
    !/[a-zA-Z0-9]/.test(sanitizedData.platformNumber)
  ) {
    errors.push(
      'Platform number must contain at least one alphanumeric character',
    );
  }

  // Vérifier que le nom commence par une lettre
  if (
    sanitizedData.platformName &&
    !/^[a-zA-Z]/.test(sanitizedData.platformName)
  ) {
    errors.push('Platform name must start with a letter');
  }

  return {
    isValid: errors.length === 0,
    errors: errors,
  };
};

// Export par défaut
export default {
  sanitizePlatformInputs,
  sanitizePlatformInputsStrict,
  sanitizePhoneNumber,
  sanitizePlatformCode,
  smartSanitizePlatformNumber,
  validateSanitizedPlatformData,
};
