/**
 * Sanitize les données du formulaire de connexion
 * @param {Object} formData - Les données du formulaire à sanitizer
 * @returns {Object} - Les données sanitizées
 */
export const sanitizeLoginInputs = (formData) => {
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

  // Application de la sanitization à chaque champ
  const sanitizedData = {
    email: sanitizeEmail(formData.email || ''),
    password: sanitizePassword(formData.password || ''),
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
      console.warn('Champs sanitizés (login):', changedFields);
    }
  }

  return sanitizedData;
};

/**
 * Version alternative plus stricte avec validation supplémentaire pour le login
 * @param {Object} formData - Les données du formulaire à sanitizer
 * @returns {Object} - Les données sanitizées avec des vérifications supplémentaires
 */
export const sanitizeLoginInputsStrict = (formData) => {
  const basicSanitized = sanitizeLoginInputs(formData);

  // Vérifications supplémentaires
  const strictSanitized = {
    ...basicSanitized,

    // Limite la longueur des champs pour éviter les attaques par déni de service
    email: basicSanitized.email.slice(0, 255),
    password: basicSanitized.password.slice(0, 128),
  };

  // Vérification additionnelle pour détecter des tentatives d'injection
  const suspiciousPatterns = [
    /<script/i,
    /javascript:/i,
    /vbscript:/i,
    /on\w+\s*=/i,
    /data:text\/html/i,
    /union\s+select/i, // Injection SQL basique
    /drop\s+table/i, // Injection SQL
    /';\s*--/i, // Commentaire SQL
  ];

  Object.entries(strictSanitized).forEach(([key, value]) => {
    if (typeof value === 'string') {
      suspiciousPatterns.forEach((pattern) => {
        if (pattern.test(value)) {
          console.warn(`Contenu suspect détecté dans le champ ${key} (login)`);
          // En production, vous pourriez vouloir logger cet événement
          // et éventuellement bloquer la tentative de connexion
        }
      });
    }
  });

  return strictSanitized;
};

/**
 * Fonction utilitaire pour détecter les tentatives de brute force
 * @param {string} email - L'email de l'utilisateur
 * @param {Object} options - Options de configuration
 * @returns {boolean} - True si l'activité semble suspecte
 */
export const detectSuspiciousLoginActivity = (email, options = {}) => {
  const {
    maxAttempts = 5,
    timeWindow = 15 * 60 * 1000, // 15 minutes en millisecondes
    storage = new Map(), // En production, utilisez Redis ou une base de données
  } = options;

  const now = Date.now();
  const key = `login_attempts_${email}`;

  // Récupère les tentatives précédentes
  const attempts = storage.get(key) || [];

  // Filtre les tentatives dans la fenêtre de temps
  const recentAttempts = attempts.filter(
    (timestamp) => now - timestamp < timeWindow,
  );

  // Ajoute la tentative actuelle
  recentAttempts.push(now);

  // Met à jour le stockage
  storage.set(key, recentAttempts);

  // Retourne true si trop de tentatives
  return recentAttempts.length > maxAttempts;
};
