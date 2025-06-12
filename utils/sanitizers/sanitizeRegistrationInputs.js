/**
 * Sanitize les données du formulaire d'inscription
 * @param {Object} formData - Les données du formulaire à sanitizer
 * @returns {Object} - Les données sanitizées
 */
export const sanitizeRegistrationInputs = (formData) => {
  // Fonction pour nettoyer le numéro de téléphone
  const sanitizePhone = (phone) => {
    if (typeof phone !== 'string') return phone;

    return (
      phone
        // Garde seulement les chiffres, +, (, ), -, espaces et points
        .replace(/[^\d+\-\s().]/g, '')
        // Supprime les espaces multiples
        .replace(/\s+/g, ' ')
        .trim()
    );
  };

  // Fonction pour sanitizer l'email
  const sanitizeEmail = (email) => {
    if (typeof email !== 'string') return email;

    return (
      email
        // Supprime les espaces
        .replace(/\s/g, '')
        // Convertit en minuscules
        .toLowerCase()
        // Garde seulement les caractères valides pour un email
        .replace(/[^a-z0-9@._-]/g, '')
        .trim()
    );
  };

  // Fonction pour sanitizer l'username
  const sanitizeUsername = (username) => {
    if (typeof username !== 'string') return username;

    return (
      username
        // Garde seulement les caractères autorisés (lettres, chiffres, ., _, -)
        .replace(/[^a-zA-Z0-9._-]/g, '')
        .trim()
    );
  };

  // Fonction pour sanitizer le mot de passe (minimal pour préserver l'intégrité)
  const sanitizePassword = (password) => {
    if (typeof password !== 'string') return password;

    return (
      password
        // Supprime seulement les caractères de contrôle dangereux
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      // Pas de trim pour préserver les espaces intentionnels dans le mot de passe
    );
  };

  // Fonction pour sanitizer la date
  const sanitizeDate = (date) => {
    if (!date) return date;

    // Si c'est déjà un objet Date, on le retourne tel quel
    if (date instanceof Date) return date;

    // Si c'est une string, on la nettoie et on vérifie le format
    if (typeof date === 'string') {
      const cleanDate = date.replace(/[^\d-]/g, '');
      // Vérifie le format YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
        return cleanDate;
      }
    }

    return '';
  };

  // Application de la sanitization à chaque champ
  const sanitizedData = {
    username: sanitizeUsername(formData.username || ''),
    email: sanitizeEmail(formData.email || ''),
    phone: sanitizePhone(formData.phone || ''),
    password: sanitizePassword(formData.password || ''),
    confirmPassword: sanitizePassword(formData.confirmPassword || ''),
    dateOfBirth: sanitizeDate(formData.dateOfBirth || ''),
    terms: Boolean(formData.terms), // Assure que c'est un boolean
  };

  // Logs pour le debugging (à supprimer en production)
  if (process.env.NODE_ENV === 'development') {
    const changedFields = [];
    Object.keys(sanitizedData).forEach((key) => {
      if (formData[key] !== sanitizedData[key] && key !== 'terms') {
        changedFields.push(key);
      }
    });

    if (changedFields.length > 0) {
      console.warn('Champs sanitizés:', changedFields);
    }
  }

  return sanitizedData;
};

/**
 * Version alternative plus stricte avec validation supplémentaire
 * @param {Object} formData - Les données du formulaire à sanitizer
 * @returns {Object} - Les données sanitizées avec des vérifications supplémentaires
 */
export const sanitizeRegistrationInputsStrict = (formData) => {
  const basicSanitized = sanitizeRegistrationInputs(formData);

  // Vérifications supplémentaires
  const strictSanitized = {
    ...basicSanitized,

    // Limite la longueur des champs pour éviter les attaques par déni de service
    username: basicSanitized.username.slice(0, 50),
    email: basicSanitized.email.slice(0, 255),
    phone: basicSanitized.phone.slice(0, 20),
    password: basicSanitized.password.slice(0, 128),
    confirmPassword: basicSanitized.confirmPassword.slice(0, 128),
  };

  // Vérification additionnelle pour détecter des tentatives d'injection
  const suspiciousPatterns = [
    /<script/i,
    /javascript:/i,
    /vbscript:/i,
    /on\w+\s*=/i,
    /data:text\/html/i,
  ];

  Object.entries(strictSanitized).forEach(([key, value]) => {
    if (typeof value === 'string') {
      suspiciousPatterns.forEach((pattern) => {
        if (pattern.test(value)) {
          console.warn(`Contenu suspect détecté dans le champ ${key}`);
          // En production, vous pourriez vouloir logger cet événement
        }
      });
    }
  });

  return strictSanitized;
};
