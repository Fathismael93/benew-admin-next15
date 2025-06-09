import * as Sentry from '@sentry/nextjs';

// Vérification de l'environnement pour une configuration conditionnelle
const environment = process.env.NODE_ENV || 'development';
const isProd = environment === 'production';
const isStaging = environment === 'staging';
const isDev = environment === 'development';

// Détection du navigateur pour une meilleure catégorisation des erreurs
const detectBrowser = () => {
  if (typeof window === 'undefined') return 'server';

  const userAgent = window.navigator.userAgent;

  if (/firefox/i.test(userAgent)) return 'firefox';
  if (/chrome/i.test(userAgent)) return 'chrome';
  if (/safari/i.test(userAgent)) return 'safari';
  if (/edge/i.test(userAgent)) return 'edge';
  if (/msie|trident/i.test(userAgent)) return 'ie';

  return 'unknown';
};

// Vérifier si une URL contient des informations sensibles spécifiques au dashboard admin
const containsSensitiveInfo = (url) => {
  if (!url) return false;

  try {
    const urlObj = new URL(url);

    // Paramètres sensibles spécifiques à votre dashboard admin
    const sensitiveParams = [
      'token',
      'password',
      'pass',
      'pwd',
      'auth',
      'key',
      'apikey',
      'api_key',
      'secret',
      'credential',
      'email',
      'user',
      'username',
      'account',
      'reset',
      'access',
      'code',
      'otp',
      'nextauth_secret',
      'session_token',
      'cloudinary_secret',
      'sentry_token',
      'db_password',
      'platform_number',
      'payment_info',
      'card_number',
      'cvv',
      'expiry',
    ];

    // Vérifier les paramètres de l'URL
    for (const param of sensitiveParams) {
      if (urlObj.searchParams.has(param)) {
        return true;
      }
    }

    // Vérifier le chemin de l'URL - routes sensibles du dashboard admin
    const sensitivePathSegments = [
      'login',
      'auth',
      'password-reset',
      'signup',
      'register',
      'dashboard',
      'admin',
      'settings',
      'verify',
      'confirmation',
      'orders',
      'users',
      'platforms',
      'payment',
      'billing',
      'profile',
      'account',
      'templates',
      'applications',
      'blog/add',
      'blog/edit',
      'edit',
      'delete',
    ];

    for (const segment of sensitivePathSegments) {
      if (urlObj.pathname.includes(segment)) {
        return true;
      }
    }
  } catch (urlError) {
    // Erreur de parsing d'URL - considérer comme sensible par sécurité
    return true;
  }

  return false;
};

// Vérification plus précise des erreurs réseau
const isNetworkError = (error) => {
  if (!error) return false;

  const errorMessage =
    typeof error === 'string' ? error : error.message || error.toString();

  const networkErrorPatterns = [
    /network/i,
    /fetch/i,
    /xhr/i,
    /request/i,
    /connect/i,
    /abort/i,
    /timeout/i,
    /offline/i,
    /failed to load/i,
    /cors/i,
    /cross-origin/i,
    /axios/i,
    /econnrefused/i,
    /econnreset/i,
    /etimedout/i,
  ];

  return networkErrorPatterns.some((pattern) => pattern.test(errorMessage));
};

// Catégorisation des erreurs spécifiques au dashboard admin
const categorizeError = (error) => {
  if (!error) return 'unknown';

  const errorStr = typeof error === 'string' ? error : JSON.stringify(error);

  // Erreurs réseau (API calls, axios, fetch)
  if (isNetworkError(error)) return 'network';

  // Erreurs d'authentification NextAuth
  if (
    /nextauth|auth|session|signin|signout|unauthorized|forbidden/i.test(
      errorStr,
    )
  ) {
    return 'authentication';
  }

  // Erreurs de rendu React et composants dashboard
  if (
    /render|component|react|prop|invalid|hook|usestate|useeffect/i.test(
      errorStr,
    )
  ) {
    return 'render';
  }

  // Erreurs de chargement de chunks et modules
  if (/load|chunk|module|import|require|dynamic|lazy/i.test(errorStr)) {
    return 'loading';
  }

  // Erreurs de référence JavaScript
  if (
    /null|undefined|cannot read|not an object|not a function|is not defined/i.test(
      errorStr,
    )
  ) {
    return 'reference';
  }

  // Erreurs de validation (Yup, formulaires)
  if (/validation|schema|required|invalid|yup|form/i.test(errorStr)) {
    return 'validation';
  }

  // Erreurs TipTap Editor
  if (/tiptap|editor|prosemirror|contenteditable/i.test(errorStr)) {
    return 'editor';
  }

  // Erreurs Cloudinary (upload d'images)
  if (/cloudinary|upload|image|media|transform/i.test(errorStr)) {
    return 'media_upload';
  }

  // Erreurs de base de données (côté client via API)
  if (/database|db|connection|query|postgres|pg/i.test(errorStr)) {
    return 'database';
  }

  // Erreurs liées aux entités métier du dashboard
  if (/template|application|article|blog|platform|order|user/i.test(errorStr)) {
    return 'business_logic';
  }

  // Erreurs de syntaxe et de type
  if (/syntax|type|argument|parameter|parse|json/i.test(errorStr)) {
    return 'syntax';
  }

  return 'application';
};

// Configuration Sentry optimisée pour le dashboard admin
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment,
  release:
    process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || '0.1.0',

  // Échantillonnage adaptatif pour dashboard admin
  tracesSampleRate: isProd ? 0.15 : isStaging ? 0.4 : 1.0,
  replaysSessionSampleRate: isProd ? 0.08 : isStaging ? 0.15 : 0.4,
  replaysOnErrorSampleRate: isProd ? 0.6 : 1.0,

  // Configuration de débogage
  debug: isDev,
  enabled:
    isProd ||
    isStaging ||
    (isDev && process.env.NEXT_PUBLIC_ENABLE_SENTRY_DEV === 'true'),

  // Traitement des erreurs selon leur catégorie
  beforeSend(event, hint) {
    // Ignorer les erreurs provenant d'extensions de navigateur
    if (
      event.request &&
      event.request.url &&
      (/^(chrome|moz|safari|edge)-extension:/.test(event.request.url) ||
        /^(chrome|moz|safari|edge):\/\//.test(event.request.url))
    ) {
      return null;
    }

    // Ajouter des informations contextuelles du dashboard
    if (typeof window !== 'undefined') {
      event.tags = event.tags || {};
      event.tags.browser = detectBrowser();
      event.tags.screen_size = `${window.innerWidth}x${window.innerHeight}`;
      event.tags.device_type =
        window.innerWidth <= 768
          ? 'mobile'
          : window.innerWidth <= 1024
            ? 'tablet'
            : 'desktop';

      // Identifier la section du dashboard
      const pathname = window.location.pathname;
      if (pathname.includes('/dashboard/')) {
        event.tags.dashboard_section = 'admin_dashboard';

        // Identifier la sous-section
        if (pathname.includes('/templates'))
          event.tags.admin_entity = 'templates';
        else if (pathname.includes('/applications'))
          event.tags.admin_entity = 'applications';
        else if (pathname.includes('/blog')) event.tags.admin_entity = 'blog';
        else if (pathname.includes('/platforms'))
          event.tags.admin_entity = 'platforms';
        else if (pathname.includes('/orders'))
          event.tags.admin_entity = 'orders';
        else if (pathname.includes('/users')) event.tags.admin_entity = 'users';
      } else if (pathname.includes('/login')) {
        event.tags.dashboard_section = 'authentication';
      } else if (pathname.includes('/register')) {
        event.tags.dashboard_section = 'registration';
      }
    }

    // Analyser et catégoriser l'erreur
    const error = hint && hint.originalException;
    if (error) {
      const category = categorizeError(error);
      event.tags = event.tags || {};
      event.tags.error_category = category;

      // Échantillonnage différencié selon la catégorie
      if (category === 'network' && Math.random() > 0.15) {
        // N'envoyer que 15% des erreurs réseau
        return null;
      }

      // Ignorer certaines erreurs de validation en développement
      if (category === 'validation' && isDev && Math.random() > 0.3) {
        return null;
      }
    }

    // Anonymiser les données utilisateur
    if (event.user) {
      delete event.user.ip_address;

      if (event.user.email) {
        const email = event.user.email;
        const atIndex = email.indexOf('@');
        if (atIndex > 0) {
          const domain = email.slice(atIndex);
          event.user.email = `${email[0]}***${domain}`;
        } else {
          event.user.email = '[FILTERED_EMAIL]';
        }
      }

      if (event.user.id) {
        const id = String(event.user.id);
        event.user.id =
          id.length > 2
            ? id.substring(0, 1) + '***' + id.slice(-1)
            : '[USER_ID]';
      }

      if (event.user.username) {
        const username = event.user.username;
        event.user.username =
          username.length > 2
            ? username[0] + '***' + username.slice(-1)
            : '[USERNAME]';
      }
    }

    // Filtrer les paramètres d'URL sensibles
    if (event.request && event.request.url) {
      try {
        if (containsSensitiveInfo(event.request.url)) {
          const url = new URL(event.request.url);

          // Supprimer tous les paramètres d'URL sensibles
          const sensitiveParams = [
            'token',
            'password',
            'accessToken',
            'key',
            'secret',
            'auth',
            'code',
            'email',
            'user',
            'username',
            'account',
            'api_key',
            'nextauth_secret',
            'session_token',
            'cloudinary_secret',
            'platform_number',
            'payment_info',
          ];

          sensitiveParams.forEach((param) => {
            if (url.searchParams.has(param)) {
              url.searchParams.set(param, '[FILTERED]');
            }
          });

          // Généraliser les URL des pages sensibles du dashboard
          if (
            url.pathname.includes('/dashboard/orders') ||
            url.pathname.includes('/dashboard/users')
          ) {
            event.request.url = `${url.origin}/dashboard/[SENSITIVE-ADMIN-PAGE]`;
          } else if (url.pathname.includes('/dashboard/platforms')) {
            event.request.url = `${url.origin}/dashboard/[PAYMENT-PLATFORMS]`;
          } else if (
            url.pathname.includes('/login') ||
            url.pathname.includes('/register')
          ) {
            event.request.url = `${url.origin}/[AUTH-PAGE]`;
          } else {
            // Masquer les IDs dans les URLs
            const maskedPath = url.pathname.replace(/\/\d+/g, '/[ID]');
            url.pathname = maskedPath;
            event.request.url = url.toString();
          }
        }
      } catch (urlParseError) {
        // URL parsing failed, anonymiser complètement
        event.request.url = '[URL_PARSE_ERROR]';
      }
    }

    // Filtrer les données sensibles dans la stack trace
    if (event.exception && event.exception.values) {
      event.exception.values.forEach((exceptionValue) => {
        // Nettoyer le message d'erreur
        if (
          exceptionValue.value &&
          containsSensitiveInfo(exceptionValue.value)
        ) {
          exceptionValue.value =
            '[Message contenant des informations sensibles]';
        }

        // Nettoyer les frames de la stack trace
        if (exceptionValue.stacktrace && exceptionValue.stacktrace.frames) {
          exceptionValue.stacktrace.frames.forEach((frame) => {
            // Anonymiser les variables locales
            if (frame.vars) {
              Object.keys(frame.vars).forEach((key) => {
                // Champs sensibles spécifiques au dashboard admin
                if (
                  key.match(
                    /password|token|auth|key|secret|credential|email|user_password|platform_number|payment|card|cvv/i,
                  )
                ) {
                  frame.vars[key] = '[FILTERED]';
                }

                // Pour les valeurs de variables qui pourraient contenir des infos sensibles
                const value = String(frame.vars[key] || '');
                if (containsSensitiveInfo(value)) {
                  frame.vars[key] = '[FILTERED]';
                }
              });
            }

            // Anonymiser les chemins de fichiers
            if (frame.filename && frame.filename.includes('node_modules')) {
              frame.filename = frame.filename.replace(
                /.*node_modules/,
                '[...]/node_modules',
              );
            }
          });
        }
      });
    }

    // Filtrer les headers sensibles
    if (event.request && event.request.headers) {
      const sensitiveHeaders = [
        'cookie',
        'authorization',
        'x-auth-token',
        'session',
        'x-api-key',
      ];
      sensitiveHeaders.forEach((header) => {
        if (event.request.headers[header]) {
          event.request.headers[header] = '[FILTERED]';
        }
      });
    }

    return event;
  },

  // Liste exhaustive des erreurs à ignorer pour le dashboard admin
  ignoreErrors: [
    // Erreurs réseau communes
    'Network request failed',
    'Failed to fetch',
    'NetworkError',
    'AbortError',
    'TypeError: Failed to fetch',
    'Load failed',
    'net::ERR_',
    'TypeError: NetworkError',
    'TypeError: Network request failed',
    'Network Error',
    'network error',
    'timeout',
    'Timeout',
    'timeout of 0ms exceeded',
    'Fetch API cannot load',
    'TIMEOUT',
    'Request timed out',
    'Connection refused',
    'Connection reset',
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',

    // Erreurs de navigation et routing Next.js
    'ResizeObserver loop limit exceeded',
    'ResizeObserver Loop Limit Exceeded',
    'Non-Error promise rejection captured',
    'NEXT_REDIRECT',
    'NEXT_NOT_FOUND',
    'page unloaded',
    'document unloaded',
    'unmounted',
    'component unmounted',
    'Minified React error',
    'Canceled',
    'Operation was aborted',
    'navigation cancelled',
    'Route Cancelled',
    'aborted',
    'User aborted',
    'User denied',
    'cancel rendering route',
    'history push',

    // Erreurs de chargement de chunks
    'Loading chunk',
    'ChunkLoadError',
    'Loading CSS chunk',
    'Failed to load module script',
    'Loading module',
    'Module not found',
    'Cannot find module',
    'Failed to load resource',
    'Import error',
    'Dynamic require',

    // Erreurs NextAuth spécifiques
    'NextAuthError',
    'OAuthCallbackError',
    'SessionRequired',
    'CredentialsSignin',

    // Erreurs Cloudinary communes
    'Upload failed',
    'Resource not found',
    'Invalid signature',
    'Cloudinary error',

    // Erreurs TipTap Editor communes
    'ProseMirror',
    'Editor transaction',
    'ContentEditableError',

    // Erreurs de validation Yup (trop communes)
    'ValidationError',
    'yup validation error',

    // Erreurs de référence communes
    'Cannot read property',
    'null is not an object',
    'undefined is not an object',
    'Object Not Found Matching Id',
    'not a function',
    'is not a function',
    "can't access property",
    'is not defined',
    'is undefined',
    'has no properties',

    // Erreurs du navigateur
    'Script error',
    'JavaScript error',
    'Out of memory',
    'Quota exceeded',
    'Maximum call stack',
    'Stack overflow',
    'DOM Exception',
    'SecurityError',

    // Erreurs de plugins/extensions
    'extension',
    'plugin',
    'chrome-extension',
    'chrome://extensions',
    'moz-extension',
    'safari-extension',

    // Erreurs spécifiques à ignorer
    'top.GLOBALS',
    'originalCreateNotification',
    'canvas.contentDocument',
    'MyApp_RemoveAllHighlights',
    "Can't find variable: ZiteReader",
    'jigsaw is not defined',
    'ComboSearch is not defined',
    'atomicFindClose',
    'fb_xd_fragment',
    'bmi_SafeAddOnload',
    'EBCallBackMessageReceived',
    'conduitPage',
    /__gcrweb/i,
    /blocked a frame with origin/i,
  ],

  // Patterns à ignorer (expressions régulières)
  denyUrls: [
    // Extensions de navigateur
    /extensions\//i,
    /^chrome:\/\//i,
    /^chrome-extension:\/\//i,
    /^moz-extension:\/\//i,
    /^safari-extension:\/\//i,
    /^safari-web-extension:\/\//i,
    /^opera:\/\//i,
    /^edge:\/\//i,

    // Services tiers
    /googleusercontent\.com/i,
    /googlesyndication\.com/,
    /adservice\.google\./,
    /google-analytics\.com/,
    /googletagmanager\.com/,
    /hotjar\.com/,
    /facebook\.net/,
    /doubleclick\.net/,
    /bat\.bing\.com/,
    /connect\.facebook\.net/,
    /platform\.twitter\.com/,
    /static\.ads-twitter\.com/,
    /analytics\.tiktok\.com/,
    /snap\.licdn\.com/,
    /static\.cloudflareinsights\.com/,

    // Outils de marketing et analytics
    /hubspot\.com/,
    /cdn\.amplitude\.com/,
    /cdn\.optimizely\.com/,
    /cdn\.mouseflow\.com/,
    /app\.chameleon\.io/,
    /js\.intercomcdn\.com/,
    /cdn\.heapanalytics\.com/,
    /js\.driftt\.com/,
    /widget\.intercom\.io/,
    /js\.sentry-cdn\.com/,
    /browser\.sentry-cdn\.com/,
    /local\.walkme\.com/,

    // Domaines de contenus et CDNs
    /cdn\.cookielaw\.org/,
    /cdn\.jsdelivr\.net/,
    /cdnjs\.cloudflare\.com/,
    /code\.jquery\.com/,
    /unpkg\.com/,
  ],

  // Intégrations avancées pour le dashboard admin
  integrations: [
    // Activation de Replay avec paramètres optimisés pour dashboard
    new Sentry.Replay({
      // Paramètres généraux
      maskAllText: true,
      blockAllMedia: true,
      maskAllInputs: true,

      // Paramètres avancés pour la protection de la vie privée du dashboard
      blockClass: [
        'sensitive-data',
        'private-info',
        'admin-sensitive',
        'user-data',
        'payment-info',
        'platform-data',
        'order-details',
      ],
      blockSelector: [
        'input[type="password"]',
        '.user-email',
        '.platform-number',
        '.payment-form',
        '.order-form',
        '.user-form',
        '[data-sensitive]',
      ].join(', '),
      maskTextSelector: [
        '.user-name',
        '.email-display',
        '.phone-display',
        '.id-display',
        '[data-private]',
      ].join(', '),
      ignoreClass: 'replay-ignore',

      // Configuration avancée du sampling pour dashboard admin
      sessionSampler: (context) => {
        if (typeof window !== 'undefined' && window.location) {
          const path = window.location.pathname;

          // Pages critiques du dashboard: plus d'échantillons
          if (
            path.includes('/dashboard/orders') ||
            path.includes('/dashboard/users')
          ) {
            return isProd ? 0.4 : 0.8; // 40% en prod, 80% ailleurs
          }

          // Pages de gestion de contenu: échantillonnage moyen
          if (
            path.includes('/dashboard/blog') ||
            path.includes('/dashboard/templates')
          ) {
            return isProd ? 0.2 : 0.6;
          }

          // Pages d'applications: échantillonnage moyen
          if (path.includes('/dashboard/applications')) {
            return isProd ? 0.15 : 0.5;
          }

          // Pages de plateformes de paiement: échantillonnage élevé
          if (path.includes('/dashboard/platforms')) {
            return isProd ? 0.3 : 0.7;
          }

          // Pages d'authentification: échantillonnage élevé
          if (path.includes('/login') || path.includes('/register')) {
            return isProd ? 0.5 : 0.9;
          }

          // Dashboard principal: échantillonnage faible
          if (path === '/dashboard' || path === '/dashboard/') {
            return isProd ? 0.1 : 0.3;
          }
        }

        // Autres pages: échantillonnage minimal
        return isProd ? 0.05 : 0.2;
      },
    }),
  ],

  // Configuration des breadcrumbs pour le dashboard
  beforeBreadcrumb(breadcrumb, hint) {
    // Filtrer les breadcrumbs sensibles
    if (breadcrumb.category === 'navigation') {
      if (breadcrumb.data && breadcrumb.data.to) {
        // Masquer les IDs dans les URLs de navigation
        breadcrumb.data.to = breadcrumb.data.to.replace(/\/\d+/g, '/[ID]');
      }
    }

    // Filtrer les breadcrumbs de console pour éviter les logs sensibles
    if (breadcrumb.category === 'console' && breadcrumb.message) {
      if (containsSensitiveInfo(breadcrumb.message)) {
        breadcrumb.message = '[Log filtré contenant des données sensibles]';
      }
    }

    // Filtrer les breadcrumbs HTTP
    if (['xhr', 'fetch'].includes(breadcrumb.category) && breadcrumb.data) {
      if (breadcrumb.data.url) {
        breadcrumb.data.url = breadcrumb.data.url.replace(/\/\d+/g, '/[ID]');

        if (containsSensitiveInfo(breadcrumb.data.url)) {
          breadcrumb.data.url = '[SENSITIVE_URL]';
        }
      }
    }

    return breadcrumb;
  },
});
