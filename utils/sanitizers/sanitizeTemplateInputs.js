// ===== FICHIER: utils/sanitizers/sanitizeTemplateInputs.js =====

/**
 * Sanitize les données du formulaire d'ajout de template
 * @param {Object} formData - Les données du formulaire à sanitizer
 * @returns {Object} - Les données sanitizées
 */
export const sanitizeTemplateInputs = (formData) => {
  // Fonction pour sanitizer le nom du template
  const sanitizeTemplateName = (templateName) => {
    if (typeof templateName !== 'string') return templateName;

    return (
      templateName
        // Garde seulement les caractères autorisés (lettres, chiffres, espaces, ., _, -)
        .replace(/[^a-zA-Z0-9._\s-]/g, '')
        // Supprime les espaces multiples
        .replace(/\s+/g, ' ')
        .trim()
    );
  };

  // Fonction pour sanitizer l'ID d'image Cloudinary
  const sanitizeImageId = (imageId) => {
    if (typeof imageId !== 'string') return imageId;

    return (
      imageId
        // Garde seulement les caractères valides pour un public_id Cloudinary
        // Cloudinary accepte: lettres, chiffres, _, -, /, .
        .replace(/[^a-zA-Z0-9._/-]/g, '')
        .trim()
    );
  };

  // Application de la sanitization à chaque champ
  const sanitizedData = {
    templateName: sanitizeTemplateName(formData.templateName || ''),
    templateImageId: sanitizeImageId(formData.templateImageId || ''),
    templateHasWeb: Boolean(formData.templateHasWeb), // Assure que c'est un boolean
    templateHasMobile: Boolean(formData.templateHasMobile), // Assure que c'est un boolean
  };

  // Logs pour le debugging (à supprimer en production)
  if (process.env.NODE_ENV === 'development') {
    const changedFields = [];
    Object.keys(sanitizedData).forEach((key) => {
      if (formData[key] !== sanitizedData[key] && !key.includes('Has')) {
        changedFields.push(key);
      }
    });

    if (changedFields.length > 0) {
      console.warn('Champs sanitizés (template):', changedFields);
    }
  }

  return sanitizedData;
};

/**
 * Version alternative plus stricte avec validation supplémentaire
 * @param {Object} formData - Les données du formulaire à sanitizer
 * @returns {Object} - Les données sanitizées avec des vérifications supplémentaires
 */
export const sanitizeTemplateInputsStrict = (formData) => {
  const basicSanitized = sanitizeTemplateInputs(formData);

  // Vérifications supplémentaires
  const strictSanitized = {
    ...basicSanitized,

    // Limite la longueur des champs pour éviter les attaques par déni de service
    templateName: basicSanitized.templateName.slice(0, 100), // Limite raisonnable pour un nom de template
    templateImageId: basicSanitized.templateImageId.slice(0, 200), // Limite pour les public_id Cloudinary
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
  ];

  Object.entries(strictSanitized).forEach(([key, value]) => {
    if (typeof value === 'string') {
      suspiciousPatterns.forEach((pattern) => {
        if (pattern.test(value)) {
          console.warn(
            `Contenu suspect détecté dans le champ ${key} (template)`,
          );
          // En production, vous pourriez vouloir logger cet événement
        }
      });
    }
  });

  return strictSanitized;
};
