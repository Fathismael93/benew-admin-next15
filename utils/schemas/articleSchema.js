// ===== FICHIER: utils/schemas/articleSchema.js =====

import * as yup from 'yup';

/**
 * Schema de validation pour l'ajout d'un article
 */
export const addArticleSchema = yup.object().shape({
  title: yup
    .string()
    .required('Title is required')
    .min(10, 'Title must be longer than 10 characters')
    .max(200, 'Title must not exceed 200 characters')
    .test(
      'no-only-spaces',
      'Title cannot contain only spaces',
      (value) => value && value.trim().length > 0,
    )
    .test(
      'no-consecutive-spaces',
      'Title cannot contain multiple consecutive spaces',
      (value) => !value || !/\s{2,}/.test(value),
    )
    .transform((value) => value?.trim()),

  text: yup
    .string()
    .required('Text is required')
    .min(500, 'Text must be longer than 500 characters')
    .max(10000, 'Text must not exceed 10000 characters')
    .test(
      'no-only-spaces',
      'Text cannot contain only spaces',
      (value) => value && value.trim().length > 0,
    )
    .transform((value) => value?.trim()),

  imageUrl: yup
    .string()
    .required('Article image is required')
    .min(1, 'Invalid article image')
    .max(200, 'Article image ID is too long')
    .matches(/^[a-zA-Z0-9._/-]+$/, 'Invalid article image format')
    .test(
      'valid-cloudinary-id',
      'Invalid Cloudinary image ID format',
      (value) => {
        if (!value) return false;
        // Vérifier que ce n'est pas juste des caractères spéciaux
        return /[a-zA-Z0-9]/.test(value);
      },
    )
    .transform((value) => value?.trim()),
});

/**
 * Schema de validation pour la mise à jour d'un article
 */
export const updateArticleSchema = yup
  .object()
  .shape({
    title: yup
      .string()
      .min(10, 'Title must be longer than 10 characters')
      .max(200, 'Title must not exceed 200 characters')
      .test(
        'no-only-spaces',
        'Title cannot contain only spaces',
        (value) => !value || value.trim().length > 0,
      )
      .test(
        'no-consecutive-spaces',
        'Title cannot contain multiple consecutive spaces',
        (value) => !value || !/\s{2,}/.test(value),
      )
      .transform((value) => value?.trim()),

    text: yup
      .string()
      .min(500, 'Text must be longer than 500 characters')
      .max(10000, 'Text must not exceed 10000 characters')
      .test(
        'no-only-spaces',
        'Text cannot contain only spaces',
        (value) => !value || value.trim().length > 0,
      )
      .transform((value) => value?.trim()),

    imageUrl: yup
      .string()
      .required('Article image is required')
      .min(1, 'Invalid article image')
      .max(200, 'Article image ID is too long')
      .matches(/^[a-zA-Z0-9._/-]+$/, 'Invalid article image format')
      .test(
        'valid-cloudinary-id',
        'Invalid Cloudinary image ID format',
        (value) => {
          if (!value) return false;
          // Vérifier que ce n'est pas juste des caractères spéciaux
          return /[a-zA-Z0-9]/.test(value);
        },
      )
      .transform((value) => value?.trim()),

    isActive: yup
      .boolean()
      .typeError('Article status must be a boolean value')
      .test('is-boolean', 'Article status must be true or false', (value) => {
        // Accepter undefined (optionnel) ou boolean
        return value === undefined || typeof value === 'boolean';
      }),
  })
  .test(
    'at-least-one-field',
    'At least one field must be provided for update',
    (values) => {
      const providedFields = Object.keys(values).filter(
        (key) =>
          values[key] !== undefined &&
          values[key] !== null &&
          (typeof values[key] === 'boolean' || values[key] !== ''),
      );
      return providedFields.length > 0;
    },
  );

/**
 * Schema de validation pour l'ID d'un article (UUID)
 */
export const articleIdSchema = yup.object().shape({
  id: yup
    .string()
    .required('Article ID is required')
    .matches(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      'Invalid article ID format (must be a valid UUID)',
    )
    .test('is-valid-uuid', 'Article ID must be a valid UUID', (value) => {
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
 * Schema de validation pour la recherche d'articles
 */
export const articleSearchSchema = yup.object().shape({
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

  isActive: yup.boolean().typeError('Active filter must be a boolean value'),
});

/**
 * Schema de validation pour plusieurs IDs d'articles (opérations bulk)
 */
export const articleIdsSchema = yup.object().shape({
  ids: yup
    .array()
    .of(
      yup
        .string()
        .matches(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
          'Each article ID must be a valid UUID',
        ),
    )
    .min(1, 'At least one article ID is required')
    .max(50, 'Cannot process more than 50 articles at once')
    .required('Article IDs are required'),
});

/**
 * Fonction utilitaire pour valider une URL d'image
 * @param {string} imageUrl - L'URL de l'image à valider
 * @returns {boolean} - True si l'URL est valide
 */
export const isValidImageUrl = (imageUrl) => {
  if (!imageUrl || typeof imageUrl !== 'string') {
    return false;
  }

  try {
    const url = new URL(imageUrl);
    const validExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
    const pathname = url.pathname.toLowerCase();

    return validExtensions.some((ext) => pathname.endsWith(ext));
  } catch {
    return false;
  }
};

/**
 * Fonction utilitaire pour nettoyer le texte d'un article
 * @param {string} text - Le texte à nettoyer
 * @returns {string|null} - Le texte nettoyé ou null si invalide
 */
export const cleanArticleText = (text) => {
  if (!text || typeof text !== 'string') {
    return null;
  }

  // Supprimer les espaces multiples et nettoyer
  const cleaned = text.trim().replace(/\s+/g, ' ');

  if (cleaned.length < 500) {
    return null;
  }

  return cleaned;
};

/**
 * Fonction utilitaire pour nettoyer le titre d'un article
 * @param {string} title - Le titre à nettoyer
 * @returns {string|null} - Le titre nettoyé ou null si invalide
 */
export const cleanArticleTitle = (title) => {
  if (!title || typeof title !== 'string') {
    return null;
  }

  // Supprimer les espaces multiples et nettoyer
  const cleaned = title.trim().replace(/\s+/g, ' ');

  if (cleaned.length < 10 || cleaned.length > 200) {
    return null;
  }

  return cleaned;
};

/**
 * Fonction utilitaire pour valider un UUID
 * @param {string} uuid - L'UUID à valider
 * @returns {boolean} - True si l'UUID est valide
 */
export const isValidUUID = (uuid) => {
  if (!uuid || typeof uuid !== 'string') {
    return false;
  }

  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidRegex.test(uuid)) {
    return false;
  }

  const emptyUUIDs = [
    '00000000-0000-0000-0000-000000000000',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
  ];

  return !emptyUUIDs.includes(uuid.toLowerCase());
};

/**
 * Fonction utilitaire pour détecter le type d'extension d'image
 * @param {string} imageUrl - L'URL de l'image à analyser
 * @returns {string} - Le type d'extension ou 'invalid'
 */
export const detectImageType = (imageUrl) => {
  if (!imageUrl || typeof imageUrl !== 'string') {
    return 'invalid';
  }

  try {
    const url = new URL(imageUrl);
    const pathname = url.pathname.toLowerCase();

    if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) {
      return 'jpeg';
    }
    if (pathname.endsWith('.png')) {
      return 'png';
    }
    if (pathname.endsWith('.gif')) {
      return 'gif';
    }
    if (pathname.endsWith('.webp')) {
      return 'webp';
    }
    if (pathname.endsWith('.svg')) {
      return 'svg';
    }

    return 'invalid';
  } catch {
    return 'invalid';
  }
};

// Export par défaut pour faciliter l'import
export default {
  addArticleSchema,
  updateArticleSchema,
  articleIdSchema,
  articleIdsSchema,
  articleSearchSchema,
  isValidImageUrl,
  cleanArticleText,
  cleanArticleTitle,
  isValidUUID,
  detectImageType,
};

// Maintien de la compatibilité avec l'ancien schema
export const articleIDSchema = articleIdSchema;
