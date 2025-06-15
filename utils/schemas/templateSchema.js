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
 */
export const templateIdSchema = yup.object().shape({
  id: yup
    .number()
    .positive("This template ID doesn't exist")
    .integer('Template ID must be an integer')
    .required('Template ID is required'),
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

// Export par défaut pour faciliter l'import
export default {
  templateAddingSchema,
  templateUpdateSchema,
  templateIdSchema,
  templateSearchSchema,
};
