import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

// CONFIGURATION MINIMALE POUR FAIRE FONCTIONNER LE BUILD
import withBundleAnalyzer from '@next/bundle-analyzer';
import { withSentryConfig } from '@sentry/nextjs';

//Add commentMore actions
const validateEnv = () => {
  const requiredVars = [
    'NEXT_PUBLIC_SITE_URL',
    'NEXTAUTH_SECRET',
    'NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME',
    'NEXT_PUBLIC_CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
    'USER_NAME',
    'HOST_NAME',
    'DB_NAME',
    'DB_PASSWORD',
    'PORT_NUMBER',
    'DB_CA',
    'SENTRY_AUTH_TOKEN',
    'NEXT_PUBLIC_SENTRY_DSN',
    'SENTRY_PROJECT',
    'SENTRY_IGNORE_API_RESOLUTION_ERROR',
    'SENTRY_ORG',
    'SENTRY_URL',
    'SENTRY_RELEASE',
    'ANALYZE',
    'CLIENT_EXISTENCE',
    'CONNECTION_TIMEOUT',
    'MAXIMUM_CLIENTS',
    'NODE_ENV',
  ];

  const missingVars = requiredVars.filter((varName) => !process.env[varName]);

  if (missingVars.length > 0) {
    console.warn(`⚠️ Missing environment variables: ${missingVars.join(', ')}`);
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        `Production build failed: Missing required environment variables: ${missingVars.join(', ')}`,
      );
    }
  }
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

validateEnv();

const bundleAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig = {
  poweredByHeader: false,

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
        port: '',
        pathname: '**',
      },
    ],
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 86400, // 1 jour
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    dangerouslyAllowSVG: true,
    contentDispositionType: 'attachment',
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },

  // Fonctionnalités expérimentales pour les performances
  experimental: {
    optimizePackageImports: [
      'react-icons',
      'axios',
      'bcryptjs',
      'next-cloudinary',
      'yup',
      '@tiptap/react',
      '@tiptap/core',
      '@tiptap/starter-kit',
      'recharts',
      'html-react-parser',
    ],
    gzipSize: true,
  },

  // Configuration du compilateur pour la production
  compiler: {
    removeConsole:
      process.env.NODE_ENV === 'production'
        ? {
            exclude: ['log', 'error', 'warn'],
          }
        : false,
    reactRemoveProperties:
      process.env.NODE_ENV === 'production'
        ? {
            properties: ['^data-testid$'],
          }
        : false,
  },

  // Timeout pour la génération de pages statiques
  staticPageGenerationTimeout: 180,

  // Configuration des en-têtes HTTP
  async headers() {
    return [
      // ===== HEADERS NEXTAUTH - PRIORITÉ MAXIMALE (à placer EN PREMIER) =====

      // 1. Route callback credentials (la plus critique)
      {
        source: '/api/auth/callback/credentials',
        headers: [
          // CORS ultra-sécurisé
          {
            key: 'Access-Control-Allow-Origin',
            value: process.env.NEXT_PUBLIC_SITE_URL || 'same-origin',
          },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'POST, OPTIONS',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value:
              'Content-Type, Authorization, X-Requested-With, Cookie, Set-Cookie',
          },
          {
            key: 'Access-Control-Allow-Credentials',
            value: 'true',
          },

          // Anti-cache ultra-strict
          {
            key: 'Cache-Control',
            value:
              'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, private',
          },
          {
            key: 'Pragma',
            value: 'no-cache',
          },
          {
            key: 'Expires',
            value: '0',
          },

          // Sécurité maximale
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },

          // Isolation
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Cross-Origin-Resource-Policy',
            value: 'same-site',
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },

          // CSP restrictif
          {
            key: 'Content-Security-Policy',
            value:
              "default-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'",
          },

          // Rate limiting ultra-strict
          {
            key: 'X-RateLimit-Window',
            value: '600', // 10 minutes
          },
          {
            key: 'X-RateLimit-Limit',
            value: '5', // 5 tentatives
          },

          // Headers métier spécifiques
          {
            key: 'X-API-Version',
            value: '1.0',
          },
          {
            key: 'X-Transaction-Type',
            value: 'credential-authentication',
          },
          {
            key: 'X-Operation-Type',
            value: 'login',
          },
          {
            key: 'X-Security-Level',
            value: 'critical',
          },
          {
            key: 'X-Database-Operations',
            value: '3',
          },
          {
            key: 'X-Sanitization-Applied',
            value: 'true',
          },
          {
            key: 'X-Bcrypt-Verification',
            value: 'enabled',
          },
          {
            key: 'X-Suspicious-Activity-Detection',
            value: 'enabled',
          },
          {
            key: 'X-Audit-Level',
            value: 'complete',
          },
        ],
      },

      // 2. Route session (appelée fréquemment)
      {
        source: '/api/auth/session',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: process.env.NEXT_PUBLIC_SITE_URL || 'same-origin',
          },
          {
            key: 'Access-Control-Allow-Credentials',
            value: 'true',
          },
          {
            key: 'Cache-Control',
            value: 'private, no-cache, no-store, must-revalidate, max-age=0',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'X-RateLimit-Window',
            value: '60', // 1 minute
          },
          {
            key: 'X-RateLimit-Limit',
            value: '30', // 30 vérifications par minute
          },
          {
            key: 'X-Operation-Type',
            value: 'session-verification',
          },
          {
            key: 'X-JWT-Validation',
            value: 'enabled',
          },
          {
            key: 'X-Database-Operations',
            value: '0',
          },
        ],
      },

      // 3. Autres routes NextAuth (signin, signout, etc.)
      {
        source: '/api/auth/:path*',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: process.env.NEXT_PUBLIC_SITE_URL || 'same-origin',
          },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'GET, POST, OPTIONS',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Content-Type, Authorization, X-Requested-With, Cookie',
          },
          {
            key: 'Access-Control-Allow-Credentials',
            value: 'true',
          },
          {
            key: 'Cache-Control',
            value:
              'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Cross-Origin-Resource-Policy',
            value: 'same-site',
          },
          {
            key: 'Content-Security-Policy',
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
          },
          {
            key: 'X-API-Version',
            value: '1.0',
          },
          {
            key: 'X-Transaction-Type',
            value: 'authentication',
          },
          {
            key: 'X-Authentication-Provider',
            value: 'nextauth',
          },
          {
            key: 'X-Security-Level',
            value: 'maximum',
          },
        ],
      },

      // 4. Page de connexion
      {
        source: '/login',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Content-Security-Policy',
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' https://upload-widget.cloudinary.com; style-src 'self' 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
          },
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate',
          },
          {
            key: 'X-Page-Type',
            value: 'authentication-form',
          },
          {
            key: 'X-CSRF-Protection',
            value: 'nextauth-enabled',
          },
        ],
      },

      // ===== HEADERS COMMUNS POUR LES ROUTES TEMPLATES MUTATIONS (ADD/EDIT/DELETE) =====
      // Configuration spécifique pour les routes de mutation de templates
      {
        source: '/api/dashboard/templates/(add|:id/edit|:id/delete)/:path*',
        headers: [
          // CORS de base (commun aux mutations)
          {
            key: 'Access-Control-Allow-Origin',
            value: process.env.NEXT_PUBLIC_SITE_URL || 'same-origin',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Content-Type, Authorization, X-Requested-With',
          },

          // Anti-cache strict (commun - toutes sont des mutations)
          {
            key: 'Cache-Control',
            value:
              'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
          },
          {
            key: 'Pragma',
            value: 'no-cache',
          },
          {
            key: 'Expires',
            value: '0',
          },

          // Sécurité de base (commun aux mutations)
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },

          // Isolation (commun aux mutations)
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'credentialless',
          },

          // Sécurité pour mutations de données (commun)
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Cross-Origin-Resource-Policy',
            value: 'same-site',
          },

          // CSP pour manipulation de données (commun)
          {
            key: 'Content-Security-Policy',
            value: "default-src 'none'; connect-src 'self'",
          },

          // Headers de traçabilité et versioning (commun)
          {
            key: 'Vary',
            value: 'Authorization, Content-Type',
          },
          {
            key: 'X-Permitted-Cross-Domain-Policies',
            value: 'none',
          },
          {
            key: 'X-API-Version',
            value: '1.0',
          },

          // Headers métier communs
          {
            key: 'X-Transaction-Type',
            value: 'mutation',
          },
          {
            key: 'X-Cache-Invalidation',
            value: 'templates',
          },
        ],
      },

      // ===== HEADERS COMMUNS POUR LES ROUTES APPLICATIONS MUTATIONS (ADD, EDIT ET DELETE) =====
      // Configuration spécifique pour les routes de mutation d'applications (/add, /[id]/edit et /[id]/delete)
      {
        source:
          '/api/dashboard/applications/(add|[^/]+/edit|[^/]+/delete)/:path*',
        headers: [
          // ===== HEADERS COMMUNS (sécurité de base) =====
          // CORS sécurisé (commun aux mutations applications)
          {
            key: 'Access-Control-Allow-Origin',
            value: process.env.NEXT_PUBLIC_SITE_URL || 'same-origin',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Content-Type, Authorization, X-Requested-With',
          },

          // Anti-cache strict pour les mutations sensibles (commun)
          {
            key: 'Cache-Control',
            value:
              'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
          },
          {
            key: 'Pragma',
            value: 'no-cache',
          },
          {
            key: 'Expires',
            value: '0',
          },

          // Sécurité de base moderne (commun)
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },

          // Isolation et sécurité moderne (commun)
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'credentialless',
          },
          {
            key: 'Cross-Origin-Resource-Policy',
            value: 'same-site',
          },

          // Sécurité pour mutations de données (commun)
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },

          // CSP pour manipulation de données (commun)
          {
            key: 'Content-Security-Policy',
            value: "default-src 'none'; connect-src 'self'",
          },

          // Headers métier communs aux applications mutations
          {
            key: 'X-API-Version',
            value: '1.0',
          },
          {
            key: 'X-Transaction-Type',
            value: 'mutation',
          },
          {
            key: 'X-Entity-Type',
            value: 'application',
          },

          // Headers de cache et validation communs
          {
            key: 'X-Cache-Invalidation',
            value: 'applications',
          },
          {
            key: 'X-Sanitization-Applied',
            value: 'true',
          },
          {
            key: 'X-Yup-Validation-Applied',
            value: 'true',
          },

          // Headers de traçabilité (commun)
          {
            key: 'Vary',
            value: 'Authorization, Content-Type',
          },
          {
            key: 'X-Permitted-Cross-Domain-Policies',
            value: 'none',
          },
        ],
      },

      // ===== HEADERS COMMUNS POUR LES ROUTES PLATFORMS MUTATIONS (ADD/EDIT/DELETE) =====
      // Configuration spécifique pour les routes de mutation de plateformes (données bancaires sensibles)
      {
        source: '/api/dashboard/platforms/(add|[^/]+/edit|[^/]+/delete)/:path*',
        headers: [
          // ===== HEADERS COMMUNS ULTRA-SÉCURISÉS (sécurité maximale pour données bancaires) =====
          // CORS ultra-restrictif (commun aux mutations plateformes)
          {
            key: 'Access-Control-Allow-Origin',
            value: process.env.NEXT_PUBLIC_SITE_URL || 'same-origin',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Content-Type, Authorization, X-Requested-With',
          },

          // Anti-cache ultra-strict pour données bancaires (commun)
          {
            key: 'Cache-Control',
            value:
              'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
          },
          {
            key: 'Pragma',
            value: 'no-cache',
          },
          {
            key: 'Expires',
            value: '0',
          },

          // Sécurité renforcée pour données bancaires (commun)
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },

          // Isolation maximale pour données sensibles (commun)
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'credentialless',
          },
          {
            key: 'Cross-Origin-Resource-Policy',
            value: 'same-site',
          },

          // Sécurité pour mutations de données bancaires (commun)
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },

          // CSP ultra-restrictive pour manipulation de données bancaires (commun)
          {
            key: 'Content-Security-Policy',
            value: "default-src 'none'; connect-src 'self'",
          },

          // Headers métier communs aux plateformes mutations
          {
            key: 'X-API-Version',
            value: '1.0',
          },
          {
            key: 'X-Transaction-Type',
            value: 'mutation',
          },
          {
            key: 'X-Entity-Type',
            value: 'platform',
          },

          // Headers de sécurité spécifiques aux données bancaires (commun)
          {
            key: 'X-Financial-Data',
            value: 'true',
          },
          {
            key: 'X-PCI-Compliance',
            value: 'required',
          },
          {
            key: 'X-Data-Sensitivity',
            value: 'high',
          },

          // Headers de cache et validation communs
          {
            key: 'X-Cache-Invalidation',
            value: 'platforms',
          },
          {
            key: 'X-Sanitization-Applied',
            value: 'true',
          },
          {
            key: 'X-Yup-Validation-Applied',
            value: 'true',
          },

          // Headers de traçabilité ultra-sécurisés (commun)
          {
            key: 'Vary',
            value: 'Authorization, Content-Type',
          },
          {
            key: 'X-Permitted-Cross-Domain-Policies',
            value: 'none',
          },

          // Headers de monitoring pour données sensibles (commun)
          {
            key: 'X-Operation-Criticality',
            value: 'high',
          },
          {
            key: 'X-Security-Level',
            value: 'maximum',
          },
        ],
      },

      // ===== HEADERS COMMUNS POUR LES ROUTES BLOG MUTATIONS (ADD/EDIT/DELETE) =====
      // Configuration spécifique pour les routes de mutation d'articles blog
      {
        source: '/api/dashboard/blog/(add|[^/]+/edit|[^/]+/delete)/:path*',
        headers: [
          // ===== HEADERS COMMUNS (sécurité de base) =====
          // CORS sécurisé (commun aux mutations blog)
          {
            key: 'Access-Control-Allow-Origin',
            value: process.env.NEXT_PUBLIC_SITE_URL || 'same-origin',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Content-Type, Authorization, X-Requested-With',
          },

          // Anti-cache strict pour les mutations sensibles (commun)
          {
            key: 'Cache-Control',
            value:
              'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
          },
          {
            key: 'Pragma',
            value: 'no-cache',
          },
          {
            key: 'Expires',
            value: '0',
          },
          {
            key: 'Surrogate-Control',
            value: 'no-store',
          },

          // Sécurité de base moderne (commun)
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },

          // Isolation et sécurité moderne (commun)
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'credentialless',
          },
          {
            key: 'Cross-Origin-Resource-Policy',
            value: 'same-site',
          },

          // Sécurité pour mutations de données (commun)
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },

          // CSP pour manipulation de données (commun)
          {
            key: 'Content-Security-Policy',
            value:
              "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'",
          },

          // Permissions limitées (commun)
          {
            key: 'Permissions-Policy',
            value:
              'geolocation=(), microphone=(), camera=(), payment=(), usb=()',
          },

          // Headers métier communs aux blog mutations
          {
            key: 'X-API-Version',
            value: '1.0',
          },
          {
            key: 'X-Transaction-Type',
            value: 'mutation',
          },
          {
            key: 'X-Entity-Type',
            value: 'blog-article',
          },

          // Headers de cache et validation communs
          {
            key: 'X-Cache-Invalidation',
            value: 'articles',
          },
          {
            key: 'X-Sanitization-Applied',
            value: 'true',
          },
          {
            key: 'X-Yup-Validation-Applied',
            value: 'true',
          },
          {
            key: 'X-Rate-Limiting-Applied',
            value: 'true',
          },

          // Headers de traçabilité (commun)
          {
            key: 'Vary',
            value: 'Authorization, Content-Type',
          },
          {
            key: 'X-Permitted-Cross-Domain-Policies',
            value: 'none',
          },
          {
            key: 'X-Robots-Tag',
            value: 'noindex, nofollow',
          },

          // Headers informatifs communs
          {
            key: 'X-Content-Category',
            value: 'blog-content',
          },
        ],
      },

      // ===== HEADERS SPÉCIFIQUES POUR BLOG/ADD UNIQUEMENT =====
      {
        source: '/api/dashboard/blog/add',
        headers: [
          // Méthodes spécifiques à add
          {
            key: 'Access-Control-Allow-Methods',
            value: 'POST, OPTIONS',
          },

          // Rate limiting spécifique à add (8/5min)
          {
            key: 'X-RateLimit-Window',
            value: '300', // 5 minutes
          },
          {
            key: 'X-RateLimit-Limit',
            value: '8',
          },

          // Operation type spécifique à add
          {
            key: 'X-Operation-Type',
            value: 'create',
          },

          // Headers métier spécifiques à add
          {
            key: 'X-Database-Operations',
            value: '2', // connection + insert
          },
        ],
      },

      // ===== HEADERS SPÉCIFIQUES POUR BLOG/ADD/SIGN-IMAGE UNIQUEMENT =====
      {
        source: '/api/dashboard/blog/add/sign-image',
        headers: [
          // CORS spécifique Cloudinary
          {
            key: 'Access-Control-Allow-Origin',
            value: process.env.NEXT_PUBLIC_SITE_URL || 'same-origin',
          },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'POST, OPTIONS',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Content-Type, Authorization, X-Requested-With',
          },

          // Anti-cache strict (signatures sensibles)
          {
            key: 'Cache-Control',
            value:
              'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
          },
          {
            key: 'Pragma',
            value: 'no-cache',
          },
          {
            key: 'Expires',
            value: '0',
          },
          {
            key: 'Surrogate-Control',
            value: 'no-store',
          },

          // Sécurité renforcée pour signatures
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },

          // Isolation et policies
          {
            key: 'Referrer-Policy',
            value: 'no-referrer', // Plus strict - évite leak de signature
          },
          {
            key: 'Cross-Origin-Resource-Policy',
            value: 'same-origin', // Plus strict que same-site
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'credentialless',
          },

          // CSP restrictif pour API de signature
          {
            key: 'Content-Security-Policy',
            value:
              "script-src https://upload-widget.cloudinary.com; connect-src 'self' https://api.cloudinary.com https://upload-widget.cloudinary.com",
          },

          // Permissions limitées
          {
            key: 'Permissions-Policy',
            value:
              'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
          },

          // Headers informatifs spécifiques blog
          {
            key: 'X-Upload-Folder',
            value: 'blog_pictures',
          },
          {
            key: 'X-API-Type',
            value: 'signature-generation',
          },
          {
            key: 'X-Entity-Type',
            value: 'blog-article',
          },
          {
            key: 'X-Operation-Type',
            value: 'image-upload-signature',
          },

          // Headers métier blog
          {
            key: 'X-API-Version',
            value: '1.0',
          },
          {
            key: 'X-Transaction-Type',
            value: 'signature',
          },
          {
            key: 'X-Service-Integration',
            value: 'cloudinary',
          },

          // Sécurité supplémentaire
          {
            key: 'X-Permitted-Cross-Domain-Policies',
            value: 'none',
          },
          {
            key: 'Vary',
            value: 'Authorization, Content-Type',
          },

          // Headers de debugging/monitoring
          {
            key: 'X-Content-Category',
            value: 'blog-media',
          },
          {
            key: 'X-Upload-Context',
            value: 'article-creation',
          },
        ],
      },

      // ===== HEADERS SPÉCIFIQUES POUR BLOG/EDIT UNIQUEMENT =====
      {
        source: '/api/dashboard/blog/[id]/edit',
        headers: [
          // Méthodes spécifiques à edit
          {
            key: 'Access-Control-Allow-Methods',
            value: 'PUT, OPTIONS',
          },

          // Rate limiting spécifique à edit (15/2min - plus permissif)
          {
            key: 'X-RateLimit-Window',
            value: '120', // 2 minutes
          },
          {
            key: 'X-RateLimit-Limit',
            value: '15',
          },

          // Validation spécifique à l'édition
          {
            key: 'X-Resource-Validation',
            value: 'article-id-required',
          },
          {
            key: 'X-UUID-Validation',
            value: 'cleaned-and-verified',
          },
          {
            key: 'X-Media-Management',
            value: 'cloudinary-cleanup',
          },
          {
            key: 'X-Business-Rules',
            value: 'partial-update-allowed',
          },

          // Operation type et performance spécifiques
          {
            key: 'X-Operation-Type',
            value: 'update',
          },
          {
            key: 'X-Operation-Criticality',
            value: 'medium',
          },
          {
            key: 'X-Database-Operations',
            value: '3', // connection + check + update
          },
          {
            key: 'X-Partial-Update',
            value: 'enabled',
          },
          {
            key: 'X-Resource-ID',
            value: 'dynamic', // ID dans l'URL
          },
        ],
      },

      // ===== HEADERS SPÉCIFIQUES POUR BLOG/DELETE UNIQUEMENT =====
      {
        source: '/api/dashboard/blog/[id]/delete',
        headers: [
          // Méthodes spécifiques à delete
          {
            key: 'Access-Control-Allow-Methods',
            value: 'DELETE, OPTIONS',
          },

          // Rate limiting ultra-strict pour delete (8/5min - comme add)
          {
            key: 'X-RateLimit-Window',
            value: '300', // 5 minutes
          },
          {
            key: 'X-RateLimit-Limit',
            value: '8',
          },

          // Validation spécifique à la suppression
          {
            key: 'X-Resource-Validation',
            value: 'article-id-required',
          },
          {
            key: 'X-UUID-Validation',
            value: 'cleaned-and-verified',
          },
          {
            key: 'X-Business-Rule-Validation',
            value: 'inactive-only',
          },
          {
            key: 'X-Media-Management',
            value: 'cloudinary-full-cleanup',
          },

          // Operation type et criticité spécifiques
          {
            key: 'X-Operation-Type',
            value: 'delete',
          },
          {
            key: 'X-Operation-Criticality',
            value: 'high',
          },
          {
            key: 'X-Database-Operations',
            value: '3', // connection + check + delete
          },
          {
            key: 'X-Validation-Steps',
            value: 'business-rules',
          },
          {
            key: 'X-Resource-State-Check',
            value: 'required',
          },

          // Headers de sécurité spécifiques aux suppressions
          {
            key: 'X-Irreversible-Operation',
            value: 'true',
          },
          {
            key: 'X-Data-Loss-Warning',
            value: 'permanent',
          },
          {
            key: 'X-Resource-ID',
            value: 'dynamic', // ID dans l'URL
          },
        ],
      },

      // ===== CONFIGURATION POUR LES AUTRES API BLOG (LECTURES) - SANS CACHE =====
      {
        source:
          '/api/dashboard/blog/((?!add|[^/]+/edit|[^/]+/delete|add/sign-image).*)',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: process.env.NEXT_PUBLIC_SITE_URL || 'same-origin',
          },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'GET, OPTIONS',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Content-Type, Authorization, X-Requested-With',
          },
          // Pas de cache selon vos instructions
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate',
          },
          {
            key: 'Pragma',
            value: 'no-cache',
          },
          {
            key: 'Expires',
            value: '0',
          },
        ],
      },

      // ===== HEADERS SPÉCIFIQUES POUR PLATFORMS/ADD UNIQUEMENT =====
      {
        source: '/api/dashboard/platforms/add',
        headers: [
          // Méthodes spécifiques à add
          {
            key: 'Access-Control-Allow-Methods',
            value: 'POST, OPTIONS',
          },

          // Rate limiting ultra-strict pour add (5/10min - le plus restrictif)
          {
            key: 'X-RateLimit-Window',
            value: '600', // 10 minutes
          },
          {
            key: 'X-RateLimit-Limit',
            value: '5',
          },

          // Validation spécifique à add (données complètes requises)
          {
            key: 'X-Resource-Validation',
            value: 'platform-data-complete',
          },
          {
            key: 'X-Required-Fields',
            value: 'platform-name,platform-number',
          },
          {
            key: 'X-Uniqueness-Check',
            value: 'platform-name-number',
          },
          {
            key: 'X-Business-Rules',
            value: 'banking-compliance',
          },

          // Operation type et criticité spécifiques
          {
            key: 'X-Operation-Type',
            value: 'create',
          },
          {
            key: 'X-Database-Operations',
            value: '3', // connection + uniqueness check + insert
          },
          {
            key: 'X-Validation-Steps',
            value: 'sanitization,yup,uniqueness',
          },

          // Headers de sécurité spécifiques à la création
          {
            key: 'X-Data-Creation',
            value: 'new-financial-platform',
          },
          {
            key: 'X-Audit-Required',
            value: 'true',
          },
        ],
      },

      // ===== HEADERS SPÉCIFIQUES POUR PLATFORMS/EDIT UNIQUEMENT =====
      {
        source: '/api/dashboard/platforms/[id]/edit',
        headers: [
          // Méthodes spécifiques à edit
          {
            key: 'Access-Control-Allow-Methods',
            value: 'PUT, OPTIONS',
          },

          // Rate limiting strict pour edit (10/5min - restrictif mais moins que add)
          {
            key: 'X-RateLimit-Window',
            value: '300', // 5 minutes
          },
          {
            key: 'X-RateLimit-Limit',
            value: '10',
          },

          // Validation spécifique à l'édition
          {
            key: 'X-Resource-Validation',
            value: 'platform-id-required',
          },
          {
            key: 'X-UUID-Validation',
            value: 'cleaned-and-verified',
          },
          {
            key: 'X-Data-Masking',
            value: 'platform-number',
          },
          {
            key: 'X-Business-Rules',
            value: 'partial-update-allowed',
          },

          // Operation type et performance spécifiques
          {
            key: 'X-Operation-Type',
            value: 'update',
          },
          {
            key: 'X-Database-Operations',
            value: '2', // connection + update (pas de uniqueness check)
          },
          {
            key: 'X-Partial-Update',
            value: 'enabled',
          },
          {
            key: 'X-Validation-Steps',
            value: 'sanitization,yup',
          },

          // Headers de sécurité spécifiques à l'édition
          {
            key: 'X-Data-Modification',
            value: 'existing-financial-platform',
          },
          {
            key: 'X-Change-Tracking',
            value: 'enabled',
          },
        ],
      },

      // ===== HEADERS SPÉCIFIQUES POUR PLATFORMS/DELETE UNIQUEMENT =====
      {
        source: '/api/dashboard/platforms/[id]/delete',
        headers: [
          // Méthodes spécifiques à delete
          {
            key: 'Access-Control-Allow-Methods',
            value: 'DELETE, OPTIONS',
          },

          // Rate limiting ultra-strict pour delete (3/15min - le plus restrictif)
          {
            key: 'X-RateLimit-Window',
            value: '900', // 15 minutes
          },
          {
            key: 'X-RateLimit-Limit',
            value: '3',
          },

          // Validation spécifique à la suppression (la plus stricte)
          {
            key: 'X-Resource-Validation',
            value: 'platform-id-required',
          },
          {
            key: 'X-UUID-Validation',
            value: 'cleaned-and-verified',
          },
          {
            key: 'X-Business-Rule-Validation',
            value: 'inactive-only',
          },
          {
            key: 'X-Financial-Safety-Check',
            value: 'no-active-transactions',
          },
          {
            key: 'X-Dependency-Check',
            value: 'no-linked-orders',
          },

          // Operation type et criticité maximale
          {
            key: 'X-Operation-Type',
            value: 'delete',
          },
          {
            key: 'X-Operation-Criticality',
            value: 'critical',
          },
          {
            key: 'X-Database-Operations',
            value: '4', // connection + safety checks + dependencies + delete
          },
          {
            key: 'X-Validation-Steps',
            value: 'business-rules,financial-safety,dependencies',
          },

          // Headers de sécurité ultra-stricts pour suppressions
          {
            key: 'X-Irreversible-Operation',
            value: 'true',
          },
          {
            key: 'X-Data-Loss-Warning',
            value: 'permanent-financial-data',
          },
          {
            key: 'X-Audit-Level',
            value: 'maximum',
          },
          {
            key: 'X-Admin-Approval',
            value: 'recommended',
          },
          {
            key: 'X-Financial-Impact',
            value: 'potential',
          },
        ],
      },

      // ===== HEADERS SPÉCIFIQUES POUR APPLICATIONS/ADD UNIQUEMENT =====
      {
        source: '/api/dashboard/applications/add',
        headers: [
          // Méthodes spécifiques à add
          {
            key: 'Access-Control-Allow-Methods',
            value: 'POST, OPTIONS',
          },

          // Rate limiting spécifique à add (8/5min)
          {
            key: 'X-RateLimit-Window',
            value: '300', // 5 minutes
          },
          {
            key: 'X-RateLimit-Limit',
            value: '8',
          },

          // Validation spécifique à add
          {
            key: 'X-Resource-Validation',
            value: 'application-data',
          },
          {
            key: 'X-Template-Validation',
            value: 'template-id-required',
          },
          {
            key: 'X-Media-Management',
            value: 'multiple-images',
          },
          {
            key: 'X-Business-Rules',
            value: 'fee-rent-validation',
          },

          // Operation type et performance spécifiques
          {
            key: 'X-Operation-Type',
            value: 'create',
          },
          {
            key: 'X-Database-Operations',
            value: '2', // connection + insert
          },
        ],
      },

      // ===== HEADERS SPÉCIFIQUES POUR APPLICATIONS/ADD/SIGN-IMAGE UNIQUEMENT =====
      {
        source: '/api/dashboard/applications/add/sign-image',
        headers: [
          // CORS spécifique Cloudinary
          {
            key: 'Access-Control-Allow-Origin',
            value: process.env.NEXT_PUBLIC_SITE_URL || 'same-origin',
          },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'POST, OPTIONS',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Content-Type, Authorization, X-Requested-With',
          },

          // Anti-cache strict (signatures sensibles)
          {
            key: 'Cache-Control',
            value:
              'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
          },
          {
            key: 'Pragma',
            value: 'no-cache',
          },
          {
            key: 'Expires',
            value: '0',
          },
          {
            key: 'Surrogate-Control',
            value: 'no-store',
          },

          // Sécurité renforcée pour signatures
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },

          // Isolation et policies
          {
            key: 'Referrer-Policy',
            value: 'no-referrer', // Plus strict - évite leak de signature
          },
          {
            key: 'Cross-Origin-Resource-Policy',
            value: 'same-origin', // Plus strict que same-site
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'credentialless',
          },

          // CSP restrictif pour API de signature
          {
            key: 'Content-Security-Policy',
            value:
              "script-src https://upload-widget.cloudinary.com; connect-src 'self' https://api.cloudinary.com https://upload-widget.cloudinary.com",
          },

          // Permissions limitées
          {
            key: 'Permissions-Policy',
            value:
              'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
          },

          // Headers informatifs spécifiques applications
          {
            key: 'X-Upload-Folder',
            value: 'applications',
          },
          {
            key: 'X-API-Type',
            value: 'signature-generation',
          },
          {
            key: 'X-Entity-Type',
            value: 'application',
          },
          {
            key: 'X-Operation-Type',
            value: 'image-upload-signature',
          },

          // Headers métier applications
          {
            key: 'X-API-Version',
            value: '1.0',
          },
          {
            key: 'X-Transaction-Type',
            value: 'signature',
          },
          {
            key: 'X-Service-Integration',
            value: 'cloudinary',
          },

          // Sécurité supplémentaire
          {
            key: 'X-Permitted-Cross-Domain-Policies',
            value: 'none',
          },
          {
            key: 'Vary',
            value: 'Authorization, Content-Type',
          },

          // Headers de debugging/monitoring
          {
            key: 'X-Content-Category',
            value: 'application-media',
          },
          {
            key: 'X-Upload-Context',
            value: 'application-creation',
          },
        ],
      },

      // ===== HEADERS SPÉCIFIQUES POUR APPLICATIONS/EDIT UNIQUEMENT =====
      {
        source: '/api/dashboard/applications/[id]/edit',
        headers: [
          // Méthodes spécifiques à edit
          {
            key: 'Access-Control-Allow-Methods',
            value: 'PUT, OPTIONS',
          },

          // Rate limiting spécifique à edit (15/2min - plus permissif)
          {
            key: 'X-RateLimit-Window',
            value: '120', // 2 minutes
          },
          {
            key: 'X-RateLimit-Limit',
            value: '15',
          },

          // Validation spécifique à l'édition
          {
            key: 'X-Resource-Validation',
            value: 'application-id-required',
          },
          {
            key: 'X-UUID-Validation',
            value: 'cleaned-and-verified',
          },
          {
            key: 'X-Media-Management',
            value: 'cloudinary-cleanup',
          },
          {
            key: 'X-Business-Rules',
            value: 'partial-update-allowed',
          },

          // Operation type et performance spécifiques
          {
            key: 'X-Operation-Type',
            value: 'update',
          },
          {
            key: 'X-Operation-Criticality',
            value: 'medium',
          },
          {
            key: 'X-Database-Operations',
            value: '3', // connection + select + update
          },
          {
            key: 'X-Partial-Update',
            value: 'enabled',
          },
        ],
      },

      // ===== HEADERS SPÉCIFIQUES POUR APPLICATIONS/DELETE UNIQUEMENT =====
      {
        source: '/api/dashboard/applications/[id]/delete',
        headers: [
          // Méthodes spécifiques à delete
          {
            key: 'Access-Control-Allow-Methods',
            value: 'DELETE, OPTIONS',
          },

          // Rate limiting ultra-strict pour delete (5/10min - le plus restrictif)
          {
            key: 'X-RateLimit-Window',
            value: '600', // 10 minutes
          },
          {
            key: 'X-RateLimit-Limit',
            value: '5',
          },

          // Validation spécifique à la suppression
          {
            key: 'X-Resource-Validation',
            value: 'application-id-required',
          },
          {
            key: 'X-UUID-Validation',
            value: 'cleaned-and-verified',
          },
          {
            key: 'X-Business-Rule-Validation',
            value: 'inactive-only',
          },
          {
            key: 'X-Sales-Validation',
            value: 'zero-sales-required',
          },
          {
            key: 'X-Media-Management',
            value: 'cloudinary-full-cleanup',
          },

          // Operation type et criticité spécifiques
          {
            key: 'X-Operation-Type',
            value: 'delete',
          },
          {
            key: 'X-Operation-Criticality',
            value: 'high',
          },
          {
            key: 'X-Database-Operations',
            value: '3', // connection + check + delete
          },
          {
            key: 'X-Validation-Steps',
            value: 'business-rules',
          },

          // Headers de sécurité spécifiques aux suppressions
          {
            key: 'X-Irreversible-Operation',
            value: 'true',
          },
          {
            key: 'X-Data-Loss-Warning',
            value: 'permanent',
          },
        ],
      },

      // ===== HEADERS SPÉCIFIQUES POUR TEMPLATES/ADD UNIQUEMENT =====
      {
        source: '/api/dashboard/templates/add/:path*',
        headers: [
          // Méthodes spécifiques à add
          {
            key: 'Access-Control-Allow-Methods',
            value: 'POST, OPTIONS',
          },

          // Rate limiting spécifique à add
          {
            key: 'X-RateLimit-Window',
            value: '300', // 5 minutes
          },
          {
            key: 'X-RateLimit-Limit',
            value: '10',
          },

          // Operation type spécifique
          {
            key: 'X-Operation-Type',
            value: 'create',
          },
        ],
      },

      // ===== HEADERS SPÉCIFIQUES POUR TEMPLATES/ADD/SIGN-IMAGE UNIQUEMENT =====
      {
        source: '/api/dashboard/templates/add/sign-image',
        headers: [
          // CORS spécifique Cloudinary
          {
            key: 'Access-Control-Allow-Origin',
            value: process.env.NEXT_PUBLIC_SITE_URL || 'same-origin',
          },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'POST, OPTIONS',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Content-Type, Authorization, X-Requested-With',
          },

          // Anti-cache strict (signatures sensibles)
          {
            key: 'Cache-Control',
            value:
              'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
          },
          {
            key: 'Pragma',
            value: 'no-cache',
          },
          {
            key: 'Expires',
            value: '0',
          },
          {
            key: 'Surrogate-Control',
            value: 'no-store',
          },

          // Sécurité renforcée pour signatures
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },

          // Isolation et policies
          {
            key: 'Referrer-Policy',
            value: 'no-referrer', // Plus strict - évite leak de signature
          },
          {
            key: 'Cross-Origin-Resource-Policy',
            value: 'same-origin', // Plus strict que same-site
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'credentialless',
          },

          // CSP restrictif pour API de signature
          {
            key: 'Content-Security-Policy',
            value:
              "script-src https://upload-widget.cloudinary.com; connect-src 'self' https://api.cloudinary.com https://upload-widget.cloudinary.com",
          },

          // Permissions limitées
          {
            key: 'Permissions-Policy',
            value:
              'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
          },

          // Headers informatifs spécifiques templates
          {
            key: 'X-Upload-Folder',
            value: 'templates',
          },
          {
            key: 'X-API-Type',
            value: 'signature-generation',
          },
          {
            key: 'X-Entity-Type',
            value: 'template',
          },
          {
            key: 'X-Operation-Type',
            value: 'image-upload-signature',
          },

          // Headers métier templates
          {
            key: 'X-API-Version',
            value: '1.0',
          },
          {
            key: 'X-Transaction-Type',
            value: 'signature',
          },
          {
            key: 'X-Service-Integration',
            value: 'cloudinary',
          },

          // Sécurité supplémentaire
          {
            key: 'X-Permitted-Cross-Domain-Policies',
            value: 'none',
          },
          {
            key: 'Vary',
            value: 'Authorization, Content-Type',
          },

          // Headers de debugging/monitoring
          {
            key: 'X-Content-Category',
            value: 'template-media',
          },
          {
            key: 'X-Upload-Context',
            value: 'template-creation',
          },
        ],
      },

      // ===== HEADERS SPÉCIFIQUES POUR TEMPLATES/EDIT UNIQUEMENT =====
      {
        source: '/api/dashboard/templates/:id/edit',
        headers: [
          // Méthodes spécifiques à edit
          {
            key: 'Access-Control-Allow-Methods',
            value: 'PUT, OPTIONS',
          },

          // Rate limiting spécifique à edit (plus permissif)
          {
            key: 'X-RateLimit-Window',
            value: '120', // 2 minutes
          },
          {
            key: 'X-RateLimit-Limit',
            value: '20',
          },

          // Operation type spécifique
          {
            key: 'X-Operation-Type',
            value: 'update',
          },

          // Headers spécifiques à l'édition
          {
            key: 'X-Resource-Validation',
            value: 'template-id',
          },
          {
            key: 'X-Media-Management',
            value: 'cloudinary',
          },
        ],
      },

      // ===== HEADERS SPÉCIFIQUES POUR TEMPLATES/DELETE UNIQUEMENT =====
      {
        source: '/api/dashboard/templates/:id/delete',
        headers: [
          // Méthodes spécifiques à delete
          {
            key: 'Access-Control-Allow-Methods',
            value: 'DELETE, OPTIONS',
          },

          // Rate limiting spécifique à delete (strict comme add)
          {
            key: 'X-RateLimit-Window',
            value: '300', // 5 minutes
          },
          {
            key: 'X-RateLimit-Limit',
            value: '10',
          },

          // Operation type spécifique
          {
            key: 'X-Operation-Type',
            value: 'delete',
          },

          // Headers spécifiques à la suppression
          {
            key: 'X-Resource-Validation',
            value: 'template-id',
          },
          {
            key: 'X-Operation-Criticality',
            value: 'high',
          },
          {
            key: 'X-Business-Rule-Validation',
            value: 'inactive-only',
          },
        ],
      },

      // Configuration CORS et cache pour les autres API templates (lectures)
      {
        source: '/api/dashboard/templates/((?!add|:id/edit|:id/delete).*)',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: process.env.NEXT_PUBLIC_SITE_URL || '*',
          },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'GET, POST, PUT, DELETE, OPTIONS',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Content-Type, Authorization, X-Requested-With',
          },
          {
            key: 'Cache-Control',
            value: 'public, max-age=300, stale-while-revalidate=600',
          },
        ],
      },

      // Configuration pour les autres API d'applications (lectures - exclut /add, /edit et /delete)
      {
        source:
          '/api/dashboard/applications/((?!add|[^/]+/edit|[^/]+/delete).*)',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: process.env.NEXT_PUBLIC_SITE_URL || '*',
          },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'GET, POST, PUT, DELETE, OPTIONS',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Content-Type, Authorization, X-Requested-With',
          },
          {
            key: 'Cache-Control',
            value: 'public, max-age=300, stale-while-revalidate=600',
          },
        ],
      },

      // ===== API D'INSCRIPTION - SÉCURITÉ RENFORCÉE POUR DONNÉES PII =====

      {
        source: '/api/register',
        headers: [
          // ===== CORS SPÉCIFIQUE REGISTRATION (public, pas d'Authorization) =====
          {
            key: 'Access-Control-Allow-Origin',
            value: process.env.NEXT_PUBLIC_SITE_URL || 'same-origin',
          },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'POST, OPTIONS', // Uniquement POST pour inscription
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Content-Type, X-Requested-With', // Pas d'Authorization (route publique)
          },

          // ===== ANTI-CACHE ULTRA-STRICT (données sensibles PII) =====
          {
            key: 'Cache-Control',
            value:
              'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
          },
          {
            key: 'Pragma',
            value: 'no-cache',
          },
          {
            key: 'Expires',
            value: '0',
          },
          {
            key: 'Surrogate-Control',
            value: 'no-store',
          },

          // ===== SÉCURITÉ RENFORCÉE POUR DONNÉES PII =====
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload', // Plus long pour auth (2 ans)
          },

          // ===== ISOLATION MAXIMALE POUR AUTH =====
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Cross-Origin-Resource-Policy',
            value: 'same-site',
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'credentialless',
          },

          // ===== CSP SPÉCIFIQUE FORMULAIRES D'INSCRIPTION =====
          {
            key: 'Content-Security-Policy',
            value:
              "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'",
          },

          // ===== PERMISSIONS LIMITÉES POUR AUTH =====
          {
            key: 'Permissions-Policy',
            value:
              'geolocation=(), microphone=(), camera=(), payment=(), usb=(), interest-cohort=()',
          },

          // ===== HEADERS SPÉCIFIQUES REGISTRATION =====
          {
            key: 'X-API-Version',
            value: '1.0',
          },
          {
            key: 'X-Transaction-Type',
            value: 'registration', // Spécifique vs 'mutation'
          },
          {
            key: 'X-Operation-Type',
            value: 'user-creation',
          },
          {
            key: 'X-Entity-Type',
            value: 'user-account',
          },

          // ===== HEADERS DE SÉCURITÉ SPÉCIFIQUES AUTH =====
          {
            key: 'X-Data-Sensitivity',
            value: 'high', // Données PII sensibles
          },
          {
            key: 'X-Authentication-Context',
            value: 'public-registration',
          },
          {
            key: 'X-Password-Hashing',
            value: 'bcrypt',
          },
          {
            key: 'X-PII-Processing',
            value: 'true',
          },

          // ===== RATE LIMITING SPÉCIFIQUE REGISTRATION =====
          {
            key: 'X-RateLimit-Window',
            value: '900', // 15 minutes (unique)
          },
          {
            key: 'X-RateLimit-Limit',
            value: '5', // 5 tentatives (unique)
          },
          {
            key: 'X-Rate-Limiting-Applied',
            value: 'true',
          },
          {
            key: 'X-Rate-Limiting-Strategy',
            value: 'ip-email-combined',
          },

          // ===== HEADERS MÉTIER REGISTRATION =====
          {
            key: 'X-Sanitization-Applied',
            value: 'true',
          },
          {
            key: 'X-Yup-Validation-Applied',
            value: 'true',
          },
          {
            key: 'X-Uniqueness-Check',
            value: 'email-required',
          },
          {
            key: 'X-Database-Operations',
            value: '3', // connection + check + insert
          },

          // ===== SÉCURITÉ SUPPLÉMENTAIRE =====
          {
            key: 'X-Permitted-Cross-Domain-Policies',
            value: 'none',
          },
          {
            key: 'X-Robots-Tag',
            value: 'noindex, nofollow', // Pas d'indexation des formulaires
          },
          {
            key: 'Vary',
            value: 'Content-Type, User-Agent',
          },

          // ===== HEADERS INFORMATIFS =====
          {
            key: 'X-Content-Category',
            value: 'user-registration',
          },
          {
            key: 'X-Operation-Criticality',
            value: 'high',
          },
        ],
      },

      // ===== RESSOURCES STATIQUES - CACHE AGRESSIF ET SÉCURITÉ =====

      // 1. Ressources Next.js compilées (_next/static/) - Cache maximal
      {
        source: '/_next/static/:path*',
        headers: [
          // Cache agressif pour ressources avec hash
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable', // 1 an
          },
          // Sécurité
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'Cross-Origin-Resource-Policy',
            value: 'cross-origin', // Permet CDN
          },
          // Performance
          {
            key: 'Vary',
            value: 'Accept-Encoding',
          },
          // Headers informatifs
          {
            key: 'X-Resource-Type',
            value: 'nextjs-compiled',
          },
          {
            key: 'X-Cache-Strategy',
            value: 'immutable-with-hash',
          },
        ],
      },

      // 2. Images statiques dans /public/images/ - Cache optimisé
      {
        source: '/images/:path*',
        headers: [
          // Cache optimisé pour images
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=3600', // 1 jour + SWR 1h
          },
          // Sécurité
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN', // Permet iframe same-origin
          },
          {
            key: 'Cross-Origin-Resource-Policy',
            value: 'cross-origin',
          },
          // Performance
          {
            key: 'Vary',
            value: 'Accept, Accept-Encoding',
          },
          // Headers informatifs
          {
            key: 'X-Resource-Type',
            value: 'static-image',
          },
          {
            key: 'X-Cache-Strategy',
            value: 'daily-with-revalidation',
          },
        ],
      },

      // 3. Fichiers SVG dans /public/ - Cache avec sécurité
      {
        source: '/:path*\\.(svg)$',
        headers: [
          // Cache modéré pour SVG
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=3600', // 1 jour + SWR 1h
          },
          // Sécurité renforcée pour SVG (risque XSS)
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'Content-Security-Policy',
            value:
              "default-src 'none'; style-src 'unsafe-inline'; script-src 'none';", // Bloque JS dans SVG
          },
          {
            key: 'Cross-Origin-Resource-Policy',
            value: 'cross-origin',
          },
          // Performance
          {
            key: 'Vary',
            value: 'Accept-Encoding',
          },
          // Headers informatifs
          {
            key: 'X-Resource-Type',
            value: 'svg-vector',
          },
          {
            key: 'X-Security-Level',
            value: 'sanitized', // SVG sans JS
          },
        ],
      },

      // 4. Polices web (fonts) - Cache maximal
      {
        source: '/:path*\\.(woff|woff2|eot|ttf|otf)$',
        headers: [
          // Cache agressif pour fonts
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable', // 1 an
          },
          // Sécurité
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Cross-Origin-Resource-Policy',
            value: 'cross-origin',
          },
          // CORS pour fonts (nécessaire pour certains navigateurs)
          {
            key: 'Access-Control-Allow-Origin',
            value: '*',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Origin, X-Requested-With, Content-Type, Accept',
          },
          // Performance
          {
            key: 'Vary',
            value: 'Accept-Encoding',
          },
          // Headers informatifs
          {
            key: 'X-Resource-Type',
            value: 'web-font',
          },
          {
            key: 'X-Cache-Strategy',
            value: 'permanent-immutable',
          },
        ],
      },

      // 5. Autres assets statiques (CSS, JS, JSON, XML, TXT dans /public/)
      {
        source: '/:path*\\.(css|js|json|xml|txt|ico|manifest)$',
        headers: [
          // Cache modéré pour assets divers
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=3600', // 1 jour + SWR 1h
          },
          // Sécurité
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'Cross-Origin-Resource-Policy',
            value: 'same-site',
          },
          // Performance
          {
            key: 'Vary',
            value: 'Accept-Encoding',
          },
          // Headers informatifs
          {
            key: 'X-Resource-Type',
            value: 'public-asset',
          },
          {
            key: 'X-Cache-Strategy',
            value: 'daily-refresh',
          },
        ],
      },

      // 6. Fichiers médias (audio/vidéo) - Cache long avec range requests
      {
        source: '/:path*\\.(mp4|mp3|webm|ogg|wav|avi|mov)$',
        headers: [
          // Cache long pour médias
          {
            key: 'Cache-Control',
            value: 'public, max-age=604800, stale-while-revalidate=86400', // 1 semaine + SWR 1 jour
          },
          // Support range requests pour streaming
          {
            key: 'Accept-Ranges',
            value: 'bytes',
          },
          // Sécurité
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'Cross-Origin-Resource-Policy',
            value: 'cross-origin',
          },
          // Performance
          {
            key: 'Vary',
            value: 'Accept-Encoding, Range',
          },
          // Headers informatifs
          {
            key: 'X-Resource-Type',
            value: 'media-file',
          },
          {
            key: 'X-Streaming-Support',
            value: 'range-requests',
          },
        ],
      },

      // 7. Documents statiques (PDF, DOC, etc.) - Cache modéré
      {
        source: '/:path*\\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar)$',
        headers: [
          // Cache modéré pour documents
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=3600', // 1 jour + SWR 1h
          },
          // Sécurité renforcée pour téléchargements
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'Content-Disposition',
            value: 'attachment', // Force téléchargement
          },
          {
            key: 'Cross-Origin-Resource-Policy',
            value: 'same-site',
          },
          // Sécurité supplémentaire
          {
            key: 'X-Download-Options',
            value: 'noopen', // IE security
          },
          // Headers informatifs
          {
            key: 'X-Resource-Type',
            value: 'document-download',
          },
          {
            key: 'X-Security-Policy',
            value: 'attachment-only',
          },
        ],
      },

      // 8. Favicon et icônes d'app - Cache long
      {
        source:
          '/:path*(favicon|apple-touch-icon|android-chrome|mstile)\\.(ico|png)$',
        headers: [
          // Cache long pour icônes
          {
            key: 'Cache-Control',
            value: 'public, max-age=2592000, stale-while-revalidate=86400', // 30 jours + SWR 1 jour
          },
          // Sécurité
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Cross-Origin-Resource-Policy',
            value: 'cross-origin',
          },
          // Performance
          {
            key: 'Vary',
            value: 'Accept-Encoding',
          },
          // Headers informatifs
          {
            key: 'X-Resource-Type',
            value: 'app-icon',
          },
          {
            key: 'X-Cache-Strategy',
            value: 'monthly-refresh',
          },
        ],
      },
    ];
  },

  // Configuration du runtime côté serveur
  serverRuntimeConfig: {
    PROJECT_ROOT: __dirname,
  },

  // Configuration publique (accessible côté client)
  publicRuntimeConfig: {
    SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    CLOUDINARY_CLOUD_NAME: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: process.env.NEXT_PUBLIC_CLOUDINARY_API_KEY,
  },

  // Configuration des redirections
  // async redirects() {
  //   // return [
  //   //   // {
  //   //   //   source: '/404',
  //   //   //   destination: '/',
  //   //   //   permanent: false,
  //   //   // },
  //   //   // {
  //   //   //   source: '/home',
  //   //   //   destination: '/',
  //   //   //   permanent: true,
  //   //   // },
  //   //   // Rediriger les anciens chemins API vers les nouveaux
  //   //   // {
  //   //   //   source: '/api/templates/:path*',
  //   //   //   destination: '/api/dashboard/templates/:path*',
  //   //   //   permanent: true,
  //   //   // },
  //   // ];
  // },

  // Configuration Webpack optimisée
  webpack: (config, { dev, isServer, buildId }) => {
    // Optimisations webpack pour la production
    if (!dev) {
      config.optimization = {
        ...config.optimization,
        moduleIds: 'deterministic',
        runtimeChunk: 'single',
        splitChunks: {
          chunks: 'all',
          minSize: 20000,
          maxSize: 244000,
          minChunks: 1,
          maxAsyncRequests: 30,
          maxInitialRequests: 30,
          automaticNameDelimiter: '~',
          cacheGroups: {
            framework: {
              chunks: 'all',
              name: 'framework',
              test: /(?<!node_modules.*)[\\/]node_modules[\\/](react|react-dom|scheduler|prop-types|use-subscription)[\\/]/,
              priority: 40,
              enforce: true,
            },
            lib: {
              test(module) {
                return (
                  module.size() > 160000 &&
                  /node_modules[/\\]/.test(module.identifier())
                );
              },
              name(module) {
                const hash = createHash('sha1');
                hash.update(module.identifier());
                return hash.digest('hex').substring(0, 8);
              },
              priority: 30,
              minChunks: 1,
              reuseExistingChunk: true,
            },
            commons: {
              name: 'commons',
              minChunks: 2,
              priority: 20,
            },
            shared: {
              name(module, chunks) {
                return `shared-${chunks.map((c) => c.name).join('~')}.${buildId}`;
              },
              priority: 10,
              minChunks: 2,
              reuseExistingChunk: true,
            },
          },
        },
      };

      // Configuration du cache pour de meilleures performances de build
      config.cache = {
        type: 'filesystem',
        buildDependencies: {
          config: [__dirname],
        },
        cacheDirectory: path.resolve(__dirname, '.next/cache/webpack'),
      };

      // Réduire les logs en production
      config.infrastructureLogging = {
        level: 'error',
      };

      // Optimisations supplémentaires pour la production
      config.optimization.usedExports = true;
      config.optimization.sideEffects = false;
    }

    // Alias pour améliorer les performances de résolution
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': path.resolve(__dirname),
    };

    // Optimisation pour les bibliothèques externes
    if (isServer) {
      config.externals = [...config.externals, 'pg-native'];
    }

    return config;
  },

  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },

  output: process.env.NODE_ENV === 'production' ? 'standalone' : undefined,

  // Optimisation des logs
  logging: {
    fetches: {
      fullUrl: process.env.NODE_ENV === 'development',
    },
  },
};

// Configuration Sentry optimisée
const sentryWebpackPluginOptions = {
  org: process.env.SENTRY_ORG || 'your-org',
  project: process.env.SENTRY_PROJECT || 'admin-dashboard',
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Optimisations pour la production
  silent: process.env.NODE_ENV === 'production',
  hideSourceMaps: process.env.NODE_ENV === 'production',
  widenClientFileUpload: true,
  transpileClientSDK: true,
  tunnelRoute: '/monitoring',

  // Configuration pour les builds
  dryRun:
    process.env.NODE_ENV !== 'production' || !process.env.SENTRY_AUTH_TOKEN,
  debug: process.env.NODE_ENV === 'development',

  // Optimisation des uploads
  include: '.next',
  ignore: ['node_modules', '*.map'],

  // Configuration des releases
  release: process.env.SENTRY_RELEASE || '1.0.0',
  deploy: {
    env: process.env.NODE_ENV,
  },
};

// Appliquer les configurations dans l'ordre : bundleAnalyzer puis Sentry
export default withSentryConfig(
  bundleAnalyzer(nextConfig),
  sentryWebpackPluginOptions,
);
