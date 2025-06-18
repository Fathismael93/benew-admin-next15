// ===== FICHIER: utils/sanitizers/sanitizeApplicationInputs.js =====

/**
 * Sanitize les données du formulaire d'ajout d'application
 * @param {Object} formData - Les données du formulaire à sanitizer
 * @returns {Object} - Les données sanitizées
 */
export const sanitizeApplicationInputs = (formData) => {
  // Fonction pour sanitizer le nom de l'application
  const sanitizeApplicationName = (name) => {
    if (typeof name !== 'string') return name;

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

    return (
      url
        // Garde les caractères valides pour une URL
        .replace(/[^a-zA-Z0-9._\s\-/:?=&%#]/g, '')
        // Supprime les espaces multiples
        .replace(/\s+/g, '')
        .trim()
    );
  };

  // Fonction pour sanitizer la description
  const sanitizeDescription = (description) => {
    if (typeof description !== 'string') return description;

    return (
      description
        // Garde les caractères alphanumériques, espaces, ponctuation de base
        .replace(/[^\w\s.,!?;:()\-'"àáâãäèéêëìíîïòóôõöùúûüÿñç]/g, '')
        // Supprime les espaces multiples
        .replace(/\s+/g, ' ')
        .trim()
    );
  };

  // Fonction pour sanitizer les nombres (fee, rent, level)
  const sanitizeNumber = (number) => {
    if (typeof number === 'number') return number;
    if (typeof number === 'string') {
      const parsed = parseInt(number, 10);
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
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

  // Fonction pour sanitizer l'UUID du template
  const sanitizeTemplateId = (templateId) => {
    if (typeof templateId !== 'string') return templateId;

    return (
      templateId
        // Garde seulement les caractères valides pour un UUID
        .replace(/[^a-fA-F0-9-]/g, '')
        .toLowerCase()
        .trim()
    );
  };

  // Application de la sanitization à chaque champ
  const sanitizedData = {
    name: sanitizeApplicationName(formData.name || ''),
    link: sanitizeUrl(formData.link || ''),
    admin: sanitizeUrl(formData.admin || ''),
    description: sanitizeDescription(formData.description || ''),
    fee: sanitizeNumber(formData.fee),
    rent: sanitizeNumber(formData.rent),
    category: sanitizeCategory(formData.category || ''),
    imageUrls: sanitizeImageUrls(formData.imageUrls || []),
    level: sanitizeNumber(formData.level),
    templateId: sanitizeTemplateId(formData.templateId || ''),
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
      console.warn('Champs sanitizés (application):', changedFields);
    }
  }

  return sanitizedData;
};

/**
 * Version alternative plus stricte avec validation supplémentaire
 * @param {Object} formData - Les données du formulaire à sanitizer
 * @returns {Object} - Les données sanitizées avec des vérifications supplémentaires
 */
export const sanitizeApplicationInputsStrict = (formData) => {
  const basicSanitized = sanitizeApplicationInputs(formData);

  // Vérifications supplémentaires
  const strictSanitized = {
    ...basicSanitized,

    // Limite la longueur des champs pour éviter les attaques par déni de service
    name: basicSanitized.name.slice(0, 100),
    link: basicSanitized.link.slice(0, 500),
    admin: basicSanitized.admin.slice(0, 500),
    description: basicSanitized.description.slice(0, 1000),
    templateId: basicSanitized.templateId.slice(0, 36), // UUID length

    // Limite le nombre d'images
    imageUrls: basicSanitized.imageUrls.slice(0, 10),

    // Assure que les nombres sont dans des plages raisonnables
    fee: Math.min(Math.max(basicSanitized.fee, 0), 100000),
    rent: Math.min(Math.max(basicSanitized.rent, 0), 50000),
    level: Math.min(Math.max(basicSanitized.level, 1), 4),
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
            `Contenu suspect détecté dans le champ ${key} (application)`,
          );
          // En production, vous pourriez vouloir logger cet événement
          // et éventuellement bloquer la soumission
        }
      });
    }
  });

  return strictSanitized;
};

/**
 * Fonction utilitaire pour valider les URLs
 * @param {string} url - L'URL à valider
 * @returns {boolean} - True si l'URL est valide
 */
export const isValidUrl = (url) => {
  if (!url || typeof url !== 'string') return false;

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
 * Fonction utilitaire pour nettoyer et valider une URL
 * @param {string} url - L'URL à nettoyer
 * @returns {string|null} - L'URL nettoyée ou null si invalide
 */
export const cleanUrl = (url) => {
  if (!url || typeof url !== 'string') return null;

  const cleaned = url.trim();
  return isValidUrl(cleaned) ? cleaned : null;
};

/**
 * Fonction utilitaire pour valider les images Cloudinary
 * @param {Array} imageUrls - Les URLs d'images à valider
 * @returns {Array} - Les URLs valides
 */
export const validateCloudinaryImages = (imageUrls) => {
  if (!Array.isArray(imageUrls)) return [];

  return imageUrls.filter((url) => {
    if (typeof url !== 'string' || url.length === 0) return false;

    // Vérifier que l'URL contient des caractères alphanumériques
    if (!/[a-zA-Z0-9]/.test(url)) return false;

    // Vérifier le format Cloudinary basique
    return /^[a-zA-Z0-9._/-]+$/.test(url);
  });
};

// Export par défaut
export default {
  sanitizeApplicationInputs,
  sanitizeApplicationInputsStrict,
  isValidUrl,
  cleanUrl,
  validateCloudinaryImages,
};
