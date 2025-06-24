// ===== FICHIER: utils/sanitizers/sanitizeArticleInputs.js =====

/**
 * Sanitize les données du formulaire d'ajout d'article
 * @param {Object} formData - Les données du formulaire à sanitizer
 * @returns {Object} - Les données sanitizées
 */
export const sanitizeArticleInputs = (formData) => {
  // Fonction pour sanitizer le titre de l'article
  const sanitizeTitle = (title) => {
    if (typeof title !== 'string') return title;

    return (
      title
        // Supprime les caractères de contrôle et les caractères non imprimables
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
        // Supprime les espaces multiples
        .replace(/\s+/g, ' ')
        // Supprime les caractères suspects
        .replace(/[<>'"&]/g, '')
        .trim()
    );
  };

  // Fonction pour sanitizer le contenu HTML de l'article
  const sanitizeContent = (content) => {
    if (typeof content !== 'string') return content;

    return (
      content
        // Supprime complètement les balises script
        .replace(/<script[^>]*>.*?<\/script>/gis, '')
        // Supprime les balises potentiellement dangereuses
        .replace(
          /<(iframe|object|embed|form|input|button|select|textarea)[^>]*>.*?<\/\1>/gis,
          '',
        )
        // Supprime les attributs d'événements JavaScript
        .replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '')
        // Supprime les protocoles JavaScript
        .replace(/javascript\s*:/gi, '')
        .replace(/vbscript\s*:/gi, '')
        // Supprime les expressions CSS dangereuses
        .replace(/expression\s*\(/gi, '')
        .replace(/behavior\s*:/gi, '')
        .replace(/binding\s*:/gi, '')
        // Nettoie les attributs style suspects
        .replace(
          /style\s*=\s*["'][^"']*(?:javascript|expression|behavior|binding)[^"']*["']/gi,
          '',
        )
        // Supprime les espaces multiples
        .replace(/\s+/g, ' ')
        // Supprime les paragraphes vides
        .replace(/<p(\s[^>]*)?>(\s|&nbsp;)*<\/p>/gi, '')
        // Supprime les caractères de contrôle
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
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
    title: sanitizeTitle(formData.title || ''),
    text: sanitizeContent(formData.text || ''),
    imageUrl: sanitizeImageId(formData.imageUrl || ''),
  };

  // Pour les mises à jour, inclure isActive si présent
  if (Object.prototype.hasOwnProperty.call(formData, 'isActive')) {
    sanitizedData.isActive = Boolean(formData.isActive);
  }

  // Logs pour le debugging (à supprimer en production)
  if (process.env.NODE_ENV === 'development') {
    const changedFields = [];
    Object.keys(sanitizedData).forEach((key) => {
      if (formData[key] !== sanitizedData[key] && key !== 'isActive') {
        changedFields.push(key);
      }
    });

    if (changedFields.length > 0) {
      console.warn('Champs sanitizés (article):', changedFields);
    }
  }

  return sanitizedData;
};

/**
 * Sanitize spécifiquement pour l'ajout d'article
 * @param {Object} formData - Les données du formulaire d'ajout
 * @returns {Object} - Les données sanitizées pour l'ajout
 */
export const sanitizeAddArticleInputs = (formData) => {
  const sanitized = sanitizeArticleInputs(formData);

  // Pour l'ajout, on s'assure que tous les champs requis sont présents
  const requiredFields = ['title', 'text', 'imageUrl'];
  const addSanitized = {};

  requiredFields.forEach((field) => {
    addSanitized[field] = sanitized[field] || '';
  });

  return addSanitized;
};

/**
 * Sanitize spécifiquement pour la mise à jour d'article
 * @param {Object} formData - Les données du formulaire de mise à jour
 * @returns {Object} - Les données sanitizées pour la mise à jour
 */
export const sanitizeUpdateArticleInputs = (formData) => {
  const sanitized = sanitizeArticleInputs(formData);

  // Pour la mise à jour, on ne garde que les champs fournis
  const updateSanitized = {};

  Object.keys(sanitized).forEach((key) => {
    if (
      Object.prototype.hasOwnProperty.call(formData, key) &&
      sanitized[key] !== undefined
    ) {
      updateSanitized[key] = sanitized[key];
    }
  });

  return updateSanitized;
};

/**
 * Version alternative plus stricte avec validation supplémentaire
 * @param {Object} formData - Les données du formulaire à sanitizer
 * @returns {Object} - Les données sanitizées avec des vérifications supplémentaires
 */
export const sanitizeArticleInputsStrict = (formData) => {
  const basicSanitized = sanitizeArticleInputs(formData);

  // Vérifications supplémentaires
  const strictSanitized = {
    ...basicSanitized,

    // Limite la longueur des champs pour éviter les attaques par déni de service
    title: basicSanitized.title.slice(0, 200), // Limite pour le titre
    text: basicSanitized.text.slice(0, 50000), // Limite raisonnable pour le contenu
    imageUrl: basicSanitized.imageUrl.slice(0, 200), // Limite pour les public_id Cloudinary
  };

  // Vérification additionnelle pour détecter des tentatives d'injection
  const suspiciousPatterns = [
    /<script[^>]*>.*?<\/script>/gi,
    /javascript:/gi,
    /vbscript:/gi,
    /on\w+\s*=/gi,
    /data:text\/html/gi,
    /\.\.\//gi, // Path traversal
    /\0/g, // Null bytes
    /eval\s*\(/gi,
    /expression\s*\(/gi,
    /setTimeout\s*\(/gi,
    /setInterval\s*\(/gi,
    /Function\s*\(/gi,
    /@import/gi,
    /binding\s*:/gi,
    /behavior\s*:/gi,
  ];

  Object.entries(strictSanitized).forEach(([key, value]) => {
    if (typeof value === 'string') {
      suspiciousPatterns.forEach((pattern) => {
        if (pattern.test(value)) {
          console.warn(
            `Contenu suspect détecté dans le champ ${key} (article)`,
          );
          // En production, vous pourriez vouloir logger cet événement
          // ou même rejeter complètement la requête
        }
      });
    }
  });

  return strictSanitized;
};

/**
 * Fonction utilitaire pour nettoyer le texte brut d'un article (sans HTML)
 * @param {string} htmlContent - Le contenu HTML à convertir en texte
 * @returns {string} - Le texte nettoyé sans HTML
 */
export const extractPlainTextFromHTML = (htmlContent) => {
  if (typeof htmlContent !== 'string') return '';

  return (
    htmlContent
      // Supprime toutes les balises HTML
      .replace(/<[^>]*>/g, '')
      // Décode les entités HTML basiques
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&nbsp;/g, ' ')
      // Remplace les espaces multiples
      .replace(/\s+/g, ' ')
      .trim()
  );
};

/**
 * Fonction utilitaire pour valider qu'un contenu HTML est sûr
 * @param {string} htmlContent - Le contenu HTML à valider
 * @returns {boolean} - True si le contenu est considéré comme sûr
 */
export const isHTMLContentSafe = (htmlContent) => {
  if (typeof htmlContent !== 'string') return false;

  const dangerous = [
    /<script/gi,
    /javascript:/gi,
    /vbscript:/gi,
    /on\w+\s*=/gi,
    /data:text\/html/gi,
    /eval\s*\(/gi,
    /expression\s*\(/gi,
    /<iframe/gi,
    /<object/gi,
    /<embed/gi,
    /<form/gi,
  ];

  return !dangerous.some((pattern) => pattern.test(htmlContent));
};

/**
 * Fonction utilitaire pour nettoyer les métadonnées d'article
 * @param {Object} metadata - Les métadonnées à nettoyer
 * @returns {Object} - Les métadonnées nettoyées
 */
export const sanitizeArticleMetadata = (metadata) => {
  if (!metadata || typeof metadata !== 'object') return {};

  const sanitized = {};

  // Description/excerpt - supprime le HTML
  if (metadata.description) {
    sanitized.description = metadata.description
      .replace(/<[^>]*>/g, '') // Supprime HTML
      .replace(/[<>'"&]/g, '') // Supprime caractères suspects
      .slice(0, 300);
  }

  // Tags - même logique que templateName
  if (Array.isArray(metadata.tags)) {
    sanitized.tags = metadata.tags
      .filter((tag) => typeof tag === 'string')
      .map((tag) => tag.replace(/[^a-zA-Z0-9\s-]/g, '').trim())
      .filter((tag) => tag.length > 0)
      .slice(0, 10);
  }

  // Catégorie
  if (metadata.category) {
    sanitized.category = metadata.category
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .trim()
      .slice(0, 50);
  }

  // Auteur
  if (metadata.author) {
    sanitized.author = metadata.author
      .replace(/[^a-zA-Z0-9\s.-]/g, '')
      .trim()
      .slice(0, 100);
  }

  return sanitized;
};

// Export par défaut pour faciliter l'import
export default {
  sanitizeArticleInputs,
  sanitizeAddArticleInputs,
  sanitizeUpdateArticleInputs,
  sanitizeArticleInputsStrict,
  extractPlainTextFromHTML,
  isHTMLContentSafe,
  sanitizeArticleMetadata,
};
