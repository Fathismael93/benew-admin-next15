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

  // Fonction pour sanitizer la couleur hexadécimale
  const sanitizeTemplateColor = (color) => {
    // Si la couleur est null, undefined ou chaîne vide, retourner null
    if (!color || color === null || color === undefined || color === '') {
      return null;
    }

    if (typeof color !== 'string') {
      return null;
    }

    // Nettoyer la couleur en supprimant les espaces
    let cleanedColor = color.trim().toLowerCase();

    // Ajouter le # si manquant
    if (!cleanedColor.startsWith('#')) {
      cleanedColor = '#' + cleanedColor;
    }

    // Garder seulement les caractères hexadécimaux valides
    cleanedColor = cleanedColor.replace(/[^#0-9a-f]/gi, '');

    // Vérifier le format hexadécimal valide (#RGB ou #RRGGBB)
    const hexColorRegex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

    if (!hexColorRegex.test(cleanedColor)) {
      console.warn(
        'Couleur hexadécimale invalide détectée, utilisation de null',
      );
      return null;
    }

    // Vérifier que ce n'est pas une couleur potentiellement problématique
    const problematicColors = ['#000', '#fff', '#ffffff', '#000000'];
    if (problematicColors.includes(cleanedColor)) {
      console.warn('Couleur problématique détectée:', cleanedColor);
      // On peut choisir de la garder ou de la remplacer selon les besoins
      // return null; // Décommentez pour rejeter ces couleurs
    }

    return cleanedColor;
  };

  // Vérifications supplémentaires
  const strictSanitized = {
    ...basicSanitized,

    // Limite la longueur des champs pour éviter les attaques par déni de service
    templateName: basicSanitized.templateName.slice(0, 100), // Limite raisonnable pour un nom de template
    templateImageId: basicSanitized.templateImageId.slice(0, 200), // Limite pour les public_id Cloudinary

    // Sanitization de la couleur du template
    templateColor: sanitizeTemplateColor(formData.templateColor),
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
    /expression\s*\(/i, // CSS expression attacks
    /url\s*\(/i, // CSS url() attacks (pour les couleurs CSS)
  ];

  Object.entries(strictSanitized).forEach(([key, value]) => {
    if (typeof value === 'string') {
      suspiciousPatterns.forEach((pattern) => {
        if (pattern.test(value)) {
          console.warn(
            `Contenu suspect détecté dans le champ ${key} (template):`,
            value,
          );
          // En production, vous pourriez vouloir logger cet événement
          // et potentiellement rejeter la requête entière
        }
      });
    }
  });

  // Validation spécifique pour la couleur si elle est présente
  if (strictSanitized.templateColor) {
    // Double vérification de sécurité pour la couleur
    const colorSecurityCheck = /^#[0-9a-f]{3,6}$/i;
    if (!colorSecurityCheck.test(strictSanitized.templateColor)) {
      console.warn('Couleur échouée à la vérification de sécurité finale');
      strictSanitized.templateColor = null;
    }
  }

  // Log des changements en mode développement
  if (process.env.NODE_ENV === 'development') {
    const originalColor = formData.templateColor;
    const sanitizedColor = strictSanitized.templateColor;

    if (originalColor !== sanitizedColor) {
      console.log('Couleur sanitizée:', {
        original: originalColor,
        sanitized: sanitizedColor,
      });
    }
  }

  return strictSanitized;
};

/**
 * Fonction utilitaire pour valider et nettoyer une couleur hexadécimale
 * @param {string} color - La couleur à valider
 * @returns {string|null} - La couleur nettoyée ou null si invalide
 */
export const validateAndCleanHexColor = (color) => {
  if (!color || typeof color !== 'string') {
    return null;
  }

  // Nettoyer et normaliser
  let cleaned = color.trim().toLowerCase();

  // Ajouter # si manquant
  if (!cleaned.startsWith('#')) {
    cleaned = '#' + cleaned;
  }

  // Supprimer les caractères non-hexadécimaux
  cleaned = cleaned.replace(/[^#0-9a-f]/gi, '');

  // Vérifier le format
  const validFormat = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

  return validFormat.test(cleaned) ? cleaned : null;
};
