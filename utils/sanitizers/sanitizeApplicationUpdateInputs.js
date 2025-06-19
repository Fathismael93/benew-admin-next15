// ===== FICHIER: utils/sanitizers/sanitizeApplicationUpdateInputs.js =====

/**
 * Sanitize les données du formulaire de modification d'application
 * Version spécialisée pour les mises à jour (champs optionnels)
 * @param {Object} formData - Les données du formulaire à sanitizer
 * @returns {Object} - Les données sanitizées
 */
export const sanitizeApplicationUpdateInputs = (formData) => {
  // Fonction pour sanitizer le nom de l'application
  const sanitizeApplicationName = (name) => {
    if (typeof name !== 'string') return name;
    if (name.trim() === '') return '';

    return (
      name
        // Garde seulement les caractères autorisés (lettres, chiffres, espaces, ., _, -)
        .replace(/[^a-zA-Z0-9._\s-]/g, '')
        // Supprime les espaces multiples
        .replace(/\s+/g, ' ')
        .trim()
    );
  };

  // Fonction pour sanitizer les URLs (link et admin)
  const sanitizeUrl = (url) => {
    if (typeof url !== 'string') return url;
    if (url.trim() === '') return null; // Retourner null pour URLs vides en modification

    return (
      url
        // Garde les caractères valides pour une URL
        .replace(/[^a-zA-Z0-9._\s\-/:?=&%#]/g, '')
        // Supprime les espaces multiples
        .replace(/\s+/g, '')
        .trim()
    );
  };

  // Fonction pour sanitizer la description (optionnelle)
  const sanitizeDescription = (description) => {
    if (typeof description !== 'string') return description;
    if (description.trim() === '') return null; // Retourner null pour description vide

    return (
      description
        // Garde les caractères alphanumériques, espaces, ponctuation de base
        .replace(/[^\w\s.,!?;:()\-'"àáâãäèéêëìíîïòóôõöùúûüÿñç]/g, '')
        // Supprime les espaces multiples
        .replace(/\s+/g, ' ')
        .trim()
    );
  };

  // Fonction pour sanitizer les nombres (fee, rent)
  const sanitizeNumber = (number) => {
    if (typeof number === 'number') return number;
    if (typeof number === 'string') {
      const parsed = parseFloat(number);
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  };

  // Fonction pour sanitizer le niveau (1-4)
  const sanitizeLevel = (level) => {
    if (typeof level === 'number') return level;
    if (typeof level === 'string') {
      const parsed = parseInt(level, 10);
      return isNaN(parsed) ? 1 : parsed;
    }
    return 1;
  };

  // Fonction pour sanitizer la catégorie
  const sanitizeCategory = (category) => {
    if (typeof category !== 'string') return category;

    const validCategories = ['web', 'mobile'];
    const cleanCategory = category.toLowerCase().trim();

    return validCategories.includes(cleanCategory) ? cleanCategory : '';
  };

  // Fonction pour sanitizer les URLs d'images Cloudinary
  const sanitizeImageUrls = (imageUrls) => {
    if (!Array.isArray(imageUrls)) return [];

    return imageUrls
      .filter((url) => typeof url === 'string' && url.length > 0)
      .map((url) =>
        url
          // Garde seulement les caractères valides pour un public_id Cloudinary
          .replace(/[^a-zA-Z0-9._/-]/g, '')
          .trim(),
      )
      .filter((url) => url.length > 0);
  };

  // Fonction pour sanitizer les autres versions (URLs séparées par virgules)
  const sanitizeOtherVersions = (otherVersions) => {
    // Si c'est déjà un array, le traiter directement
    if (Array.isArray(otherVersions)) {
      return otherVersions
        .filter((url) => typeof url === 'string' && url.trim().length > 0)
        .map((url) => sanitizeUrl(url))
        .filter((url) => url !== null && url.length > 0);
    }

    // Si c'est une string, la diviser par virgules
    if (typeof otherVersions === 'string') {
      const urls = otherVersions
        .split(',')
        .map((url) => url.trim())
        .filter((url) => url.length > 0)
        .map((url) => sanitizeUrl(url))
        .filter((url) => url !== null && url.length > 0);

      return urls.length > 0 ? urls : null;
    }

    return null;
  };

  // Sanitization conditionnelle - seulement pour les champs fournis
  const sanitizedData = {};

  // Traiter chaque champ seulement s'il est présent
  if (formData.name !== undefined) {
    sanitizedData.name = sanitizeApplicationName(formData.name);
  }

  if (formData.link !== undefined) {
    sanitizedData.link = sanitizeUrl(formData.link);
  }

  if (formData.admin !== undefined) {
    sanitizedData.admin = sanitizeUrl(formData.admin);
  }

  if (formData.description !== undefined) {
    sanitizedData.description = sanitizeDescription(formData.description);
  }

  if (formData.fee !== undefined) {
    sanitizedData.fee = sanitizeNumber(formData.fee);
  }

  if (formData.rent !== undefined) {
    sanitizedData.rent = sanitizeNumber(formData.rent);
  }

  if (formData.category !== undefined) {
    sanitizedData.category = sanitizeCategory(formData.category);
  }

  if (formData.level !== undefined) {
    sanitizedData.level = sanitizeLevel(formData.level);
  }

  if (formData.imageUrls !== undefined) {
    sanitizedData.imageUrls = sanitizeImageUrls(formData.imageUrls);
  }

  if (formData.otherVersions !== undefined) {
    sanitizedData.otherVersions = sanitizeOtherVersions(formData.otherVersions);
  }

  // Les champs non sanitizés selon vos instructions (isActive, oldImageUrls)
  if (formData.isActive !== undefined) {
    sanitizedData.isActive = formData.isActive; // Non sanitizé
  }

  if (formData.oldImageUrls !== undefined) {
    sanitizedData.oldImageUrls = formData.oldImageUrls; // Non sanitizé (logique interne)
  }

  // Logs pour le debugging (à supprimer en production)
  if (process.env.NODE_ENV === 'development') {
    const changedFields = [];
    Object.keys(sanitizedData).forEach((key) => {
      if (formData[key] !== sanitizedData[key]) {
        changedFields.push(key);
      }
    });

    if (changedFields.length > 0) {
      console.warn('Champs sanitizés (application update):', changedFields);
    }
  }

  return sanitizedData;
};

/**
 * Version stricte avec validation supplémentaire pour les modifications
 * @param {Object} formData - Les données du formulaire à sanitizer
 * @returns {Object} - Les données sanitizées avec des vérifications supplémentaires
 */
export const sanitizeApplicationUpdateInputsStrict = (formData) => {
  const basicSanitized = sanitizeApplicationUpdateInputs(formData);

  // Vérifications supplémentaires avec limites appropriées
  const strictSanitized = { ...basicSanitized };

  // Limite la longueur des champs pour éviter les attaques par déni de service
  if (strictSanitized.name !== undefined) {
    strictSanitized.name = strictSanitized.name.slice(0, 100);
  }

  if (strictSanitized.link !== undefined && strictSanitized.link !== null) {
    strictSanitized.link = strictSanitized.link.slice(0, 500);
  }

  if (strictSanitized.admin !== undefined && strictSanitized.admin !== null) {
    strictSanitized.admin = strictSanitized.admin.slice(0, 500);
  }

  if (
    strictSanitized.description !== undefined &&
    strictSanitized.description !== null
  ) {
    strictSanitized.description = strictSanitized.description.slice(0, 1000);
  }

  // Limite le nombre d'images et autres versions
  if (strictSanitized.imageUrls !== undefined) {
    strictSanitized.imageUrls = strictSanitized.imageUrls.slice(0, 10);
  }

  if (
    strictSanitized.otherVersions !== undefined &&
    Array.isArray(strictSanitized.otherVersions)
  ) {
    strictSanitized.otherVersions = strictSanitized.otherVersions.slice(0, 5);
  }

  // Assure que les nombres sont dans des plages raisonnables
  if (strictSanitized.fee !== undefined) {
    strictSanitized.fee = Math.min(Math.max(strictSanitized.fee, 0), 100000);
  }

  if (strictSanitized.rent !== undefined) {
    strictSanitized.rent = Math.min(Math.max(strictSanitized.rent, 0), 50000);
  }

  if (strictSanitized.level !== undefined) {
    strictSanitized.level = Math.min(Math.max(strictSanitized.level, 1), 4);
  }

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
    /eval\s*\(/i, // Code injection
    /document\./i, // DOM manipulation
    /window\./i, // Window object access
  ];

  Object.entries(strictSanitized).forEach(([key, value]) => {
    if (typeof value === 'string') {
      suspiciousPatterns.forEach((pattern) => {
        if (pattern.test(value)) {
          console.warn(
            `Contenu suspect détecté dans le champ ${key} (application update)`,
          );

          // En production, logger cet événement pour monitoring
          if (process.env.NODE_ENV === 'production') {
            // Intégration avec votre système de logging/monitoring
            console.error('SECURITY_ALERT', {
              type: 'suspicious_content',
              field: key,
              pattern: pattern.toString(),
              timestamp: new Date().toISOString(),
              operation: 'application_update',
            });
          }
        }
      });
    }

    // Vérifier les arrays (imageUrls, otherVersions)
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (typeof item === 'string') {
          suspiciousPatterns.forEach((pattern) => {
            if (pattern.test(item)) {
              console.warn(
                `Contenu suspect détecté dans ${key}[${index}] (application update)`,
              );
            }
          });
        }
      });
    }
  });

  return strictSanitized;
};

/**
 * Fonction utilitaire pour valider les URLs dans le contexte de modification
 * @param {string} url - L'URL à valider
 * @returns {boolean} - True si l'URL est valide ou vide (optionnelle)
 */
export const isValidUrlOrEmpty = (url) => {
  if (!url || typeof url !== 'string' || url.trim() === '') return true; // Vide = valide pour modification

  try {
    // Ajouter https:// si pas de protocole
    const testUrl = url.startsWith('http') ? url : `https://${url}`;
    new URL(testUrl);
    return true;
  } catch {
    return false;
  }
};

/**
 * Fonction utilitaire pour nettoyer et valider une URL optionnelle
 * @param {string} url - L'URL à nettoyer
 * @returns {string|null} - L'URL nettoyée, null si vide, ou null si invalide
 */
export const cleanUrlOptional = (url) => {
  if (!url || typeof url !== 'string' || url.trim() === '') return null;

  const cleaned = url.trim();
  return isValidUrlOrEmpty(cleaned) ? cleaned : null;
};

/**
 * Fonction utilitaire pour valider les modifications d'images Cloudinary
 * @param {Array} imageUrls - Les URLs d'images à valider
 * @param {Array} oldImageUrls - Les anciennes URLs pour comparaison
 * @returns {Object} - Objet avec les URLs valides et les images à supprimer
 */
export const validateImageUpdates = (imageUrls, oldImageUrls = []) => {
  const validNewImages = Array.isArray(imageUrls)
    ? imageUrls.filter((url) => {
        if (typeof url !== 'string' || url.length === 0) return false;
        if (!/[a-zA-Z0-9]/.test(url)) return false;
        return /^[a-zA-Z0-9._/-]+$/.test(url);
      })
    : [];

  const imagesToDelete = Array.isArray(oldImageUrls)
    ? oldImageUrls.filter((oldImg) => !validNewImages.includes(oldImg))
    : [];

  return {
    validImages: validNewImages,
    imagesToDelete,
    hasChanges:
      validNewImages.length !== oldImageUrls.length ||
      imagesToDelete.length > 0,
  };
};

/**
 * Fonction utilitaire pour valider les données avant sanitization
 * @param {Object} formData - Les données à valider
 * @returns {Object} - Résultat de validation avec erreurs éventuelles
 */
export const validateApplicationUpdateData = (formData) => {
  const errors = {};

  // Vérifier que au moins un champ est fourni pour la modification
  const updatableFields = [
    'name',
    'link',
    'admin',
    'description',
    'category',
    'level',
    'fee',
    'rent',
    'imageUrls',
    'otherVersions',
    'isActive',
  ];

  const providedFields = updatableFields.filter(
    (field) => formData[field] !== undefined,
  );

  if (providedFields.length === 0) {
    errors.general = 'At least one field must be provided for update';
  }

  // Validations spécifiques
  if (
    formData.name !== undefined &&
    (!formData.name || formData.name.trim().length < 3)
  ) {
    errors.name = 'Application name must be at least 3 characters long';
  }

  if (
    formData.link !== undefined &&
    formData.link &&
    !isValidUrlOrEmpty(formData.link)
  ) {
    errors.link = 'Invalid application link URL';
  }

  if (
    formData.admin !== undefined &&
    formData.admin &&
    !isValidUrlOrEmpty(formData.admin)
  ) {
    errors.admin = 'Invalid admin link URL';
  }

  if (formData.level !== undefined) {
    const level = parseInt(formData.level);
    if (isNaN(level) || level < 1 || level > 4) {
      errors.level = 'Application level must be between 1 and 4';
    }
  }

  if (
    formData.category !== undefined &&
    formData.category &&
    !['web', 'mobile'].includes(formData.category.toLowerCase())
  ) {
    errors.category = 'Category must be either "web" or "mobile"';
  }

  if (
    formData.imageUrls !== undefined &&
    (!Array.isArray(formData.imageUrls) || formData.imageUrls.length === 0)
  ) {
    errors.imageUrls = 'At least one image is required';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    providedFields,
  };
};

// Export par défaut
export default {
  sanitizeApplicationUpdateInputs,
  sanitizeApplicationUpdateInputsStrict,
  isValidUrlOrEmpty,
  cleanUrlOptional,
  validateImageUpdates,
  validateApplicationUpdateData,
};
