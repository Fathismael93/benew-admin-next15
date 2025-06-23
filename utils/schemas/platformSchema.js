// ===== FICHIER: utils/schemas/platformSchema.js =====

import * as yup from 'yup';

/**
 * Schema de validation pour l'ajout d'une plateforme de paiement
 */
export const platformAddingSchema = yup.object().shape({
  platformName: yup
    .string()
    .required('Platform name is required')
    .min(3, 'Platform name must be at least 3 characters')
    .max(50, 'Platform name must not exceed 50 characters')
    .matches(
      /^[a-zA-Z0-9._\s-]+$/,
      'Platform name can only contain letters, numbers, spaces, and ._-',
    )
    .matches(/^[a-zA-Z]/, 'Platform name must start with a letter')
    .test(
      'no-only-spaces',
      'Platform name cannot contain only spaces',
      (value) => value && value.trim().length > 0,
    )
    .test(
      'no-consecutive-spaces',
      'Platform name cannot contain multiple consecutive spaces',
      (value) => !value || !/\s{2,}/.test(value),
    )
    .test(
      'reserved-words',
      'This platform name is not allowed',
      (value) =>
        ![
          'admin',
          'root',
          'system',
          'test',
          'platform',
          'default',
          'payment',
        ].includes(value?.toLowerCase().trim()),
    )
    .transform((value) => value?.trim()),

  platformNumber: yup
    .string()
    .required('Platform number is required')
    .min(3, 'Platform number must be at least 3 characters')
    .max(50, 'Platform number must not exceed 50 characters')
    .test(
      'valid-platform-number',
      'Platform number must be a valid phone number or code',
      (value) => {
        if (!value) return false;

        // Regex pour numéro de téléphone international
        const phoneRegex =
          /^[+]?[(]?[0-9]{1,4}[)]?[-\s.]?[0-9]{1,4}[-\s.]?[0-9]{1,9}$/;

        // Regex pour code alphanumériques (ex: codes de plateforme)
        const codeRegex = /^[a-zA-Z0-9._-]+$/;

        // Accepter soit un numéro de téléphone soit un code
        return phoneRegex.test(value) || codeRegex.test(value);
      },
    )
    .test(
      'phone-length-validation',
      'Phone number must be between 6 and 15 digits',
      (value) => {
        if (!value) return false;

        // Si c'est un numéro de téléphone (contient des chiffres)
        if (/\d/.test(value)) {
          const digitsOnly = value.replace(/\D/g, '');
          return digitsOnly.length >= 6 && digitsOnly.length <= 15;
        }

        // Si c'est un code (pas de validation de longueur de chiffres)
        return true;
      },
    )
    .test(
      'no-only-spaces-or-special',
      'Platform number cannot contain only spaces or special characters',
      (value) => {
        if (!value) return false;
        // Doit contenir au moins un caractère alphanumérique
        return /[a-zA-Z0-9]/.test(value);
      },
    )
    .transform((value) => value?.trim()),
});

/**
 * Schema de validation pour la mise à jour d'une plateforme
 */
export const platformUpdateSchema = yup
  .object()
  .shape({
    platformName: yup
      .string()
      .min(3, 'Platform name must be at least 3 characters')
      .max(50, 'Platform name must not exceed 50 characters')
      .matches(
        /^[a-zA-Z0-9._\s-]+$/,
        'Platform name can only contain letters, numbers, spaces, and ._-',
      )
      .test(
        'no-only-spaces',
        'Platform name cannot contain only spaces',
        (value) => !value || value.trim().length > 0,
      )
      .test(
        'no-consecutive-spaces',
        'Platform name cannot contain multiple consecutive spaces',
        (value) => !value || !/\s{2,}/.test(value),
      )
      .test('reserved-words', 'This platform name is not allowed', (value) => {
        if (!value) return true;
        return ![
          'admin',
          'root',
          'system',
          'test',
          'platform',
          'default',
          'payment',
        ].includes(value.toLowerCase().trim());
      })
      .transform((value) => value?.trim()),

    platformNumber: yup
      .string()
      .min(3, 'Platform number must be at least 3 characters')
      .max(50, 'Platform number must not exceed 50 characters')
      .test(
        'valid-platform-number',
        'Platform number must be a valid phone number or code',
        (value) => {
          if (!value) return true; // Optionnel pour update

          const phoneRegex =
            /^[+]?[(]?[0-9]{1,4}[)]?[-\s.]?[0-9]{1,4}[-\s.]?[0-9]{1,9}$/;
          const codeRegex = /^[a-zA-Z0-9._-]+$/;

          return phoneRegex.test(value) || codeRegex.test(value);
        },
      )
      .transform((value) => value?.trim()),
  })
  .test(
    'at-least-one-field',
    'At least one field must be provided for update',
    (values) => {
      const providedFields = Object.keys(values).filter(
        (key) =>
          values[key] !== undefined &&
          values[key] !== null &&
          values[key] !== '',
      );
      return providedFields.length > 0;
    },
  );

/**
 * Schema de validation pour l'ID d'une plateforme (UUID)
 */
export const platformIdSchema = yup.object().shape({
  id: yup
    .string()
    .required('Platform ID is required')
    .matches(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      'Invalid platform ID format (must be a valid UUID)',
    )
    .test('is-valid-uuid', 'Platform ID must be a valid UUID', (value) => {
      if (!value) return false;

      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

      if (!uuidRegex.test(value)) {
        return false;
      }

      const emptyUUIDs = [
        '00000000-0000-0000-0000-000000000000',
        'ffffffff-ffff-ffff-ffff-ffffffffffff',
      ];

      return !emptyUUIDs.includes(value.toLowerCase());
    })
    .transform((value) => value?.toLowerCase().trim()),
});

/**
 * Schema de validation pour la recherche de plateformes
 */
export const platformSearchSchema = yup.object().shape({
  query: yup
    .string()
    .max(100, 'Search query is too long')
    .matches(
      /^[a-zA-Z0-9._\s-]*$/,
      'Search query can only contain letters, numbers, spaces, and ._-',
    )
    .transform((value) => value?.trim()),

  limit: yup
    .number()
    .positive('Limit must be positive')
    .integer('Limit must be an integer')
    .max(100, 'Limit cannot exceed 100')
    .default(20),

  offset: yup
    .number()
    .min(0, 'Offset cannot be negative')
    .integer('Offset must be an integer')
    .default(0),
});

/**
 * Schema de validation pour plusieurs IDs de plateformes (opérations bulk)
 */
export const platformIdsSchema = yup.object().shape({
  ids: yup
    .array()
    .of(
      yup
        .string()
        .matches(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
          'Each platform ID must be a valid UUID',
        ),
    )
    .min(1, 'At least one platform ID is required')
    .max(50, 'Cannot process more than 50 platforms at once')
    .required('Platform IDs are required'),
});

/**
 * Fonction utilitaire pour valider un numéro de téléphone
 * @param {string} phoneNumber - Le numéro de téléphone à valider
 * @returns {boolean} - True si le numéro est valide
 */
export const isValidPhoneNumber = (phoneNumber) => {
  if (!phoneNumber || typeof phoneNumber !== 'string') {
    return false;
  }

  const phoneRegex =
    /^[+]?[(]?[0-9]{1,4}[)]?[-\s.]?[0-9]{1,4}[-\s.]?[0-9]{1,9}$/;

  if (!phoneRegex.test(phoneNumber)) {
    return false;
  }

  // Vérifier la longueur des chiffres
  const digitsOnly = phoneNumber.replace(/\D/g, '');
  return digitsOnly.length >= 6 && digitsOnly.length <= 15;
};

/**
 * Fonction utilitaire pour valider un code de plateforme
 * @param {string} platformCode - Le code à valider
 * @returns {boolean} - True si le code est valide
 */
export const isValidPlatformCode = (platformCode) => {
  if (!platformCode || typeof platformCode !== 'string') {
    return false;
  }

  const codeRegex = /^[a-zA-Z0-9._-]+$/;
  return codeRegex.test(platformCode) && platformCode.length >= 3;
};

/**
 * Fonction utilitaire pour nettoyer un numéro de plateforme
 * @param {string} platformNumber - Le numéro à nettoyer
 * @returns {string|null} - Le numéro nettoyé ou null si invalide
 */
export const cleanPlatformNumber = (platformNumber) => {
  if (!platformNumber || typeof platformNumber !== 'string') {
    return null;
  }

  const cleaned = platformNumber.trim();

  if (isValidPhoneNumber(cleaned) || isValidPlatformCode(cleaned)) {
    return cleaned;
  }

  return null;
};

/**
 * Fonction utilitaire pour détecter le type de numéro de plateforme
 * @param {string} platformNumber - Le numéro à analyser
 * @returns {string} - 'phone', 'code', ou 'invalid'
 */
export const detectPlatformNumberType = (platformNumber) => {
  if (!platformNumber || typeof platformNumber !== 'string') {
    return 'invalid';
  }

  if (isValidPhoneNumber(platformNumber)) {
    return 'phone';
  }

  if (isValidPlatformCode(platformNumber)) {
    return 'code';
  }

  return 'invalid';
};

// Export par défaut pour faciliter l'import
export default {
  platformAddingSchema,
  platformUpdateSchema,
  platformIdSchema,
  platformIdsSchema,
  platformSearchSchema,
  isValidPhoneNumber,
  isValidPlatformCode,
  cleanPlatformNumber,
  detectPlatformNumberType,
};
