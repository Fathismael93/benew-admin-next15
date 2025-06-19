// ===== FICHIER: utils/schemas/applicationSchema.js =====

import * as yup from 'yup';

/**
 * Schema de validation pour l'ajout d'une application
 */
export const applicationAddingSchema = yup
  .object()
  .shape({
    name: yup
      .string()
      .required('Application name is required')
      .min(3, 'Application name must be at least 3 characters')
      .max(100, 'Application name must not exceed 100 characters')
      .matches(
        /^[a-zA-Z0-9._\s-]+$/,
        'Application name can only contain letters, numbers, spaces, and ._-',
      )
      .matches(/^[a-zA-Z]/, 'Application name must start with a letter')
      .test(
        'no-only-spaces',
        'Application name cannot contain only spaces',
        (value) => value && value.trim().length > 0,
      )
      .test(
        'no-consecutive-spaces',
        'Application name cannot contain multiple consecutive spaces',
        (value) => !value || !/\s{2,}/.test(value),
      )
      .test(
        'reserved-words',
        'This application name is not allowed',
        (value) =>
          ![
            'admin',
            'root',
            'system',
            'test',
            'app',
            'application',
            'default',
          ].includes(value?.toLowerCase().trim()),
      )
      .transform((value) => value?.trim()),

    link: yup
      .string()
      .required('Application link is required')
      .min(3, 'Application link must be at least 3 characters')
      .max(500, 'Application link must not exceed 500 characters')
      .matches(
        /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/,
        'Invalid URL format',
      )
      .test('valid-url', 'Please provide a valid URL', (value) => {
        if (!value) return false;
        try {
          // Ajouter https:// si pas de protocole
          const url = value.startsWith('http') ? value : `https://${value}`;
          new URL(url);
          return true;
        } catch {
          return false;
        }
      })
      .transform((value) => value?.trim()),

    admin: yup
      .string()
      .required('Admin link is required')
      .min(3, 'Admin link must be at least 3 characters')
      .max(500, 'Admin link must not exceed 500 characters')
      .matches(
        /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/,
        'Invalid admin URL format',
      )
      .test('valid-admin-url', 'Please provide a valid admin URL', (value) => {
        if (!value) return false;
        try {
          // Ajouter https:// si pas de protocole
          const url = value.startsWith('http') ? value : `https://${value}`;
          new URL(url);
          return true;
        } catch {
          return false;
        }
      })
      .transform((value) => value?.trim()),

    description: yup
      .string()
      .max(1000, 'Description must not exceed 1000 characters')
      .test(
        'no-only-spaces',
        'Description cannot contain only spaces',
        (value) => !value || value.trim().length > 0,
      )
      .transform((value) => value?.trim() || null), // null si vide car optionnel

    fee: yup
      .number()
      .required('Opening fee is required')
      .positive('Opening fee must be positive')
      .min(1, 'Opening fee must be at least 1')
      .max(100000, 'Opening fee cannot exceed 100,000')
      .integer('Opening fee must be a whole number')
      .typeError('Opening fee must be a valid number'),

    rent: yup
      .number()
      .required('Monthly rent is required')
      .min(0, 'Monthly rent cannot be negative')
      .max(50000, 'Monthly rent cannot exceed 50,000')
      .integer('Monthly rent must be a whole number')
      .typeError('Monthly rent must be a valid number'),

    category: yup
      .string()
      .required('Category is required')
      .oneOf(['web', 'mobile'], 'Category must be either "web" or "mobile"'),

    imageUrls: yup
      .array()
      .of(
        yup
          .string()
          .matches(/^[a-zA-Z0-9._/-]+$/, 'Invalid image format')
          .test(
            'valid-cloudinary-id',
            'Invalid Cloudinary image ID format',
            (value) => {
              if (!value) return false;
              // Vérifier que ce n'est pas juste des caractères spéciaux
              return /[a-zA-Z0-9]/.test(value);
            },
          ),
      )
      .min(1, 'At least one image is required')
      .max(10, 'Cannot upload more than 10 images')
      .required('Application images are required'),

    level: yup
      .number()
      .required('Application level is required')
      .min(1, 'Application level must be between 1 and 4')
      .max(4, 'Application level must be between 1 and 4')
      .integer('Application level must be a whole number')
      .typeError('Application level must be a valid number'),

    templateId: yup
      .string()
      .required('Template selection is required')
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
  })
  .test(
    'category-template-compatibility',
    'Selected category must be compatible with the chosen template',
    function (values) {
      // Cette validation nécessiterait les données du template côté client
      // Pour l'instant, on fait une validation basique
      if (!values.category || !values.templateId) {
        return true; // Laisse les validations individuelles gérer ces cas
      }

      // Cette validation sera complétée côté serveur avec les données du template
      return true;
    },
  );

/**
 * Schema de validation pour la mise à jour d'une application
 * Correspond aux champs du formulaire EditApplication.jsx
 */
export const applicationUpdateSchema = yup
  .object()
  .shape({
    // Champ obligatoire: nom de l'application
    name: yup
      .string()
      .required('Application name is required')
      .min(3, 'Application name must be at least 3 characters')
      .max(100, 'Application name must not exceed 100 characters')
      .matches(
        /^[a-zA-Z0-9._\s-]+$/,
        'Application name can only contain letters, numbers, spaces, and ._-',
      )
      .matches(/^[a-zA-Z]/, 'Application name must start with a letter')
      .test(
        'no-only-spaces',
        'Application name cannot contain only spaces',
        (value) => value && value.trim().length > 0,
      )
      .test(
        'no-consecutive-spaces',
        'Application name cannot contain multiple consecutive spaces',
        (value) => !value || !/\s{2,}/.test(value),
      )
      .test(
        'reserved-words',
        'This application name is not allowed',
        (value) => {
          if (!value) return true;
          return ![
            'admin',
            'root',
            'system',
            'test',
            'app',
            'application',
            'default',
          ].includes(value.toLowerCase().trim());
        },
      )
      .transform((value) => value?.trim()),

    // Champ obligatoire: lien public de l'application
    link: yup
      .string()
      .required('Application link is required')
      .min(3, 'Application link must be at least 3 characters')
      .max(500, 'Application link must not exceed 500 characters')
      .matches(
        /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/,
        'Invalid URL format',
      )
      .test('valid-url', 'Please provide a valid URL', (value) => {
        if (!value) return false;
        try {
          // Ajouter https:// si pas de protocole
          const url = value.startsWith('http') ? value : `https://${value}`;
          new URL(url);
          return true;
        } catch {
          return false;
        }
      })
      .transform((value) => value?.trim()),

    // Champ optionnel: lien d'administration
    admin: yup
      .string()
      .nullable()
      .when('admin', (admin, schema) => {
        // Si admin est fourni et n'est pas vide
        if (admin && admin.trim().length > 0) {
          return schema
            .min(3, 'Admin link must be at least 3 characters')
            .max(500, 'Admin link must not exceed 500 characters')
            .matches(
              /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/,
              'Invalid admin URL format',
            )
            .test(
              'valid-admin-url',
              'Please provide a valid admin URL',
              (value) => {
                try {
                  const url = value.startsWith('http')
                    ? value
                    : `https://${value}`;
                  new URL(url);
                  return true;
                } catch {
                  return false;
                }
              },
            );
        }
        return schema;
      })
      .transform((value) => {
        if (!value || value.trim() === '') return null;
        return value.trim();
      }),

    // Champ optionnel: description
    description: yup
      .string()
      .nullable()
      .max(1000, 'Description must not exceed 1000 characters')
      .test(
        'no-only-spaces',
        'Description cannot contain only spaces',
        (value) => !value || value.trim().length > 0,
      )
      .transform((value) => {
        if (!value || value.trim() === '') return null;
        return value.trim();
      }),

    // Champ obligatoire: frais d'ouverture
    fee: yup
      .number()
      .required('Opening fee is required')
      .positive('Opening fee must be positive')
      .min(1, 'Opening fee must be at least 1')
      .max(100000, 'Opening fee cannot exceed 100,000')
      .test('is-number', 'Opening fee must be a valid number', (value) => {
        return !isNaN(value) && isFinite(value);
      })
      .transform((value) => {
        // Convertir string en number si nécessaire
        const parsed = typeof value === 'string' ? parseFloat(value) : value;
        return isNaN(parsed) ? undefined : parsed;
      }),

    // Champ obligatoire: loyer mensuel
    rent: yup
      .number()
      .required('Monthly rent is required')
      .min(0, 'Monthly rent cannot be negative')
      .max(50000, 'Monthly rent cannot exceed 50,000')
      .test('is-number', 'Monthly rent must be a valid number', (value) => {
        return !isNaN(value) && isFinite(value);
      })
      .transform((value) => {
        // Convertir string en number si nécessaire
        const parsed = typeof value === 'string' ? parseFloat(value) : value;
        return isNaN(parsed) ? undefined : parsed;
      }),

    // Champ obligatoire: catégorie (web/mobile)
    category: yup
      .string()
      .required('Category is required')
      .oneOf(['web', 'mobile'], 'Category must be either "web" or "mobile"'),

    // Champ obligatoire: niveau (1-4)
    level: yup
      .number()
      .required('Application level is required')
      .min(1, 'Application level must be between 1 and 4')
      .max(4, 'Application level must be between 1 and 4')
      .integer('Application level must be a whole number')
      .test(
        'is-valid-level',
        'Application level must be 1, 2, 3, or 4',
        (value) => {
          return [1, 2, 3, 4].includes(value);
        },
      )
      .transform((value) => {
        // Convertir string en number si nécessaire
        const parsed = typeof value === 'string' ? parseInt(value, 10) : value;
        return isNaN(parsed) ? undefined : parsed;
      }),

    // Champ obligatoire: images de l'application
    imageUrls: yup
      .array()
      .of(
        yup
          .string()
          .matches(/^[a-zA-Z0-9._/-]+$/, 'Invalid image format')
          .test(
            'valid-cloudinary-id',
            'Invalid Cloudinary image ID format',
            (value) => {
              if (!value) return false;
              // Vérifier que ce n'est pas juste des caractères spéciaux
              return /[a-zA-Z0-9]/.test(value);
            },
          ),
      )
      .min(1, 'At least one image is required')
      .max(10, 'Cannot upload more than 10 images')
      .required('Application images are required'),

    // Champ optionnel: autres versions
    otherVersions: yup
      .array()
      .of(
        yup
          .string()
          .url('Each version must be a valid URL')
          .max(500, 'Version URL must not exceed 500 characters'),
      )
      .max(5, 'Cannot have more than 5 other versions')
      .nullable()
      .transform((value) => {
        // Si c'est un array vide ou null, retourner null
        if (!value || (Array.isArray(value) && value.length === 0)) {
          return null;
        }
        // Filtrer les URLs vides
        if (Array.isArray(value)) {
          const filtered = value.filter((url) => url && url.trim().length > 0);
          return filtered.length > 0 ? filtered : null;
        }
        return value;
      }),

    // Champ obligatoire: statut actif/inactif
    isActive: yup
      .boolean()
      .required('Application status is required')
      .typeError('Application status must be true or false'),
  })
  .test(
    'has-required-fields',
    'All required fields must be provided',
    (values) => {
      const requiredFields = [
        'name',
        'link',
        'fee',
        'rent',
        'category',
        'level',
        'imageUrls',
        'isActive',
      ];

      for (const field of requiredFields) {
        if (
          values[field] === undefined ||
          values[field] === null ||
          values[field] === ''
        ) {
          return false;
        }

        // Vérification spéciale pour imageUrls
        if (
          field === 'imageUrls' &&
          (!Array.isArray(values[field]) || values[field].length === 0)
        ) {
          return false;
        }
      }

      return true;
    },
  );

/**
 * Schema de validation pour l'ID d'une application
 */
export const applicationIdSchema = yup.object().shape({
  id: yup
    .string()
    .required('Application ID is required')
    .matches(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      'Invalid application ID format (must be a valid UUID)',
    )
    .test('is-valid-uuid', 'Application ID must be a valid UUID', (value) => {
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

// Fonction pour nettoyer et valider un UUID
export const cleanUUID = (uuid) => {
  if (!uuid || typeof uuid !== 'string') {
    return null;
  }

  // Supprimer les espaces et convertir en minuscules
  const cleaned = uuid.trim().toLowerCase();

  // Vérifier le format UUID
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  if (!uuidRegex.test(cleaned)) {
    return null;
  }

  return cleaned;
};

/**
 * Schema de validation pour la recherche d'applications
 */
export const applicationSearchSchema = yup.object().shape({
  query: yup
    .string()
    .max(100, 'Search query is too long')
    .matches(
      /^[a-zA-Z0-9._\s-]*$/,
      'Search query can only contain letters, numbers, spaces, and ._-',
    )
    .transform((value) => value?.trim()),

  category: yup.string().oneOf(['web', 'mobile'], 'Invalid category'),
  level: yup.number().min(1).max(4).integer(),
  minFee: yup.number().min(0),
  maxFee: yup.number().min(0),
  minRent: yup.number().min(0),
  maxRent: yup.number().min(0),

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
  applicationAddingSchema,
  applicationUpdateSchema,
  applicationIdSchema,
  applicationSearchSchema,
  cleanUUID,
};
