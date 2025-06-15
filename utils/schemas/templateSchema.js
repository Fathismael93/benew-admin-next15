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
      .transform((value) => value?.trim()),

    templateImageId: yup
      .string()
      .min(1, 'Invalid template image')
      .max(200, 'Template image ID is too long')
      .matches(/^[a-zA-Z0-9._/-]+$/, 'Invalid template image format'),

    templateHasWeb: yup.boolean(),

    templateHasMobile: yup.boolean(),
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

// Export par défaut pour faciliter l'import
export default {
  templateAddingSchema,
  templateUpdateSchema,
  templateIdSchema,
  templateIdsSchema,
  templateSearchSchema,
  isValidUUID,
  cleanUUID,
};
