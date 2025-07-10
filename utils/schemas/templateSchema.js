// ===== FICHIER: utils/schemas/templateSchema.js =====

import * as yup from 'yup';

/**
 * Schema de validation pour l'ajout d'un template
 */
export const templateAddingSchema = yup
  .object()
  .shape({
    templateName: yup
      .string()
      .required('Template name is required')
      .min(3, 'Template name must be at least 3 characters')
      .max(100, 'Template name must not exceed 100 characters')
      .matches(
        /^[a-zA-Z0-9._\s-]+$/,
        'Template name can only contain letters, numbers, spaces, and ._-',
      )
      .matches(/^[a-zA-Z]/, 'Template name must start with a letter')
      .test(
        'no-only-spaces',
        'Template name cannot contain only spaces',
        (value) => value && value.trim().length > 0,
      )
      .test(
        'no-consecutive-spaces',
        'Template name cannot contain multiple consecutive spaces',
        (value) => !value || !/\s{2,}/.test(value),
      )
      .test(
        'reserved-words',
        'This template name is not allowed',
        (value) =>
          !['admin', 'root', 'system', 'test', 'template', 'default'].includes(
            value?.toLowerCase().trim(),
          ),
      )
      .transform((value) => value?.trim()),

    templateImageId: yup
      .string()
      .required('Template image is required')
      .min(1, 'Invalid template image')
      .max(200, 'Template image ID is too long')
      .matches(/^[a-zA-Z0-9._/-]+$/, 'Invalid template image format')
      .test(
        'valid-cloudinary-id',
        'Invalid Cloudinary image ID format',
        (value) => {
          if (!value) return false;
          // Vérifier que ce n'est pas juste des caractères spéciaux
          return /[a-zA-Z0-9]/.test(value);
        },
      ),

    templateHasWeb: yup.boolean().required('Web availability is required'),

    templateHasMobile: yup
      .boolean()
      .required('Mobile availability is required'),
  })
  .test(
    'at-least-one-platform',
    'Template must be available for at least one platform (Web or Mobile)',
    (values) => {
      return (
        values.templateHasWeb === true || values.templateHasMobile === true
      );
    },
  );

/**
 * Schema de validation pour la mise à jour d'un template (moins strict)
 */
export const templateUpdateSchema = yup
  .object()
  .shape({
    templateName: yup
      .string()
      .min(3, 'Template name must be at least 3 characters')
      .max(100, 'Template name must not exceed 100 characters')
      .matches(
        /^[a-zA-Z0-9._\s-]+$/,
        'Template name can only contain letters, numbers, spaces, and ._-',
      )
      .test(
        'no-only-spaces',
        'Template name cannot contain only spaces',
        (value) => !value || value.trim().length > 0,
      )
      .test(
        'no-consecutive-spaces',
        'Template name cannot contain multiple consecutive spaces',
        (value) => !value || !/\s{2,}/.test(value),
      )
      .test('reserved-words', 'This template name is not allowed', (value) => {
        if (!value) return true; // Si pas de valeur, pas de validation
        return ![
          'admin',
          'root',
          'system',
          'test',
          'template',
          'default',
        ].includes(value.toLowerCase().trim());
      })
      .transform((value) => value?.trim()),

    templateImageId: yup
      .string()
      .min(1, 'Invalid template image')
      .max(200, 'Template image ID is too long')
      .matches(/^[a-zA-Z0-9._/-]+$/, 'Invalid template image format')
      .test(
        'valid-cloudinary-id',
        'Invalid Cloudinary image ID format',
        (value) => {
          if (!value) return true; // Si pas de valeur, pas de validation pour update
          // Vérifier que ce n'est pas juste des caractères spéciaux
          return /[a-zA-Z0-9]/.test(value);
        },
      ),

    templateColor: yup
      .string()
      .nullable()
      .test(
        'valid-hex-color',
        'Template color must be a valid hexadecimal color (e.g., #3b82f6)',
        (value) => {
          // Si la valeur est null, undefined ou chaîne vide, c'est acceptable
          if (!value || value === null || value === undefined) {
            return true;
          }

          // Vérifier le format hexadécimal
          const hexColorRegex = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

          if (!hexColorRegex.test(value)) {
            return false;
          }

          // Validation additionnelle pour s'assurer que ce n'est pas juste des caractères invalides
          const color = value.toLowerCase();

          // Vérifier que ce n'est pas des couleurs potentiellement problématiques
          const invalidColors = ['#000', '#fff', '#ffffff', '#000000'];

          return !invalidColors.includes(color);
        },
      )
      .transform((value) => {
        // Si la valeur est une chaîne vide, la transformer en null
        if (value === '' || value === undefined) {
          return null;
        }
        // Normaliser la casse (toujours en minuscules)
        return value?.toLowerCase().trim();
      }),

    templateHasWeb: yup.boolean(),

    templateHasMobile: yup.boolean(),

    isActive: yup
      .boolean()
      .typeError('Active status must be a boolean value')
      .test('valid-boolean', 'Active status must be true or false', (value) => {
        // Accepter undefined pour les mises à jour partielles
        if (value === undefined) return true;
        // Vérifier que c'est bien un boolean
        return typeof value === 'boolean';
      }),
  })
  .test(
    'at-least-one-platform-if-provided',
    'Template must be available for at least one platform (Web or Mobile)',
    (values) => {
      // Si les valeurs sont fournies, au moins une doit être true
      if (
        values.templateHasWeb !== undefined ||
        values.templateHasMobile !== undefined
      ) {
        return (
          values.templateHasWeb === true || values.templateHasMobile === true
        );
      }
      return true; // Si aucune valeur n'est fournie, c'est OK pour une mise à jour partielle
    },
  )
  .test(
    'at-least-one-field',
    'At least one field must be provided for update',
    (values) => {
      // Vérifier qu'au moins un champ est fourni pour la mise à jour
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
 * Schema de validation pour l'ID d'un template (pour les opérations CRUD)
 * Valide les UUID générés par PostgreSQL
 */
export const templateIdSchema = yup.object().shape({
  id: yup
    .string()
    .required('Template ID is required')
    .matches(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      'Invalid template ID format (must be a valid UUID)',
    )
    .test('is-valid-uuid', 'Template ID must be a valid UUID', (value) => {
      if (!value) return false;

      // Vérifier le format UUID plus strictement
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

      if (!uuidRegex.test(value)) {
        return false;
      }

      // Vérifier que ce n'est pas un UUID vide ou par défaut
      const emptyUUIDs = [
        '00000000-0000-0000-0000-000000000000',
        'ffffffff-ffff-ffff-ffff-ffffffffffff',
      ];

      return !emptyUUIDs.includes(value.toLowerCase());
    })
    .transform((value) => value?.toLowerCase().trim()),
});

/**
 * Schema de validation pour la recherche de templates
 */
export const templateSearchSchema = yup.object().shape({
  query: yup
    .string()
    .max(100, 'Search query is too long')
    .matches(
      /^[a-zA-Z0-9._\s-]*$/,
      'Search query can only contain letters, numbers, spaces, and ._-',
    )
    .transform((value) => value?.trim()),

  hasWeb: yup.boolean(),
  hasMobile: yup.boolean(),

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
 * Schema de validation pour plusieurs IDs de template (opérations bulk)
 */
export const templateIdsSchema = yup.object().shape({
  ids: yup
    .array()
    .of(
      yup
        .string()
        .matches(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
          'Each template ID must be a valid UUID',
        ),
    )
    .min(1, 'At least one template ID is required')
    .max(50, 'Cannot process more than 50 templates at once')
    .required('Template IDs are required'),
});

/**
 * Fonction utilitaire pour valider un UUID individuel
 * @param {string} uuid - L'UUID à valider
 * @returns {boolean} - True si l'UUID est valide
 */
export const isValidUUID = (uuid) => {
  if (!uuid || typeof uuid !== 'string') {
    return false;
  }

  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

/**
 * Fonction utilitaire pour nettoyer et valider un UUID
 * @param {string} uuid - L'UUID à nettoyer
 * @returns {string|null} - L'UUID nettoyé ou null si invalide
 */
export const cleanUUID = (uuid) => {
  if (!uuid || typeof uuid !== 'string') {
    return null;
  }

  const cleaned = uuid.toLowerCase().trim();
  return isValidUUID(cleaned) ? cleaned : null;
};

/**
 * Fonction utilitaire pour valider une couleur hexadécimale
 * @param {string} color - La couleur à valider
 * @returns {boolean} - True si la couleur est valide
 */
export const isValidHexColor = (color) => {
  if (!color || typeof color !== 'string') {
    return false;
  }

  const hexColorRegex = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
  return hexColorRegex.test(color);
};

/**
 * Fonction utilitaire pour nettoyer et valider une couleur hexadécimale
 * @param {string} color - La couleur à nettoyer
 * @returns {string|null} - La couleur nettoyée ou null si invalide
 */
export const cleanHexColor = (color) => {
  if (!color || typeof color !== 'string') {
    return null;
  }

  const cleaned = color.toLowerCase().trim();
  return isValidHexColor(cleaned) ? cleaned : null;
};

// Export par défaut pour faciliter l'import
export default {
  templateAddingSchema,
  templateUpdateSchema,
  templateIdSchema,
  templateIdsSchema,
  templateSearchSchema,
  isValidUUID,
  cleanUUID,
  isValidHexColor,
  cleanHexColor,
};
