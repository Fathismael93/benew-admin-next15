import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

// SUPPRIMER COMPLÈTEMENT SENTRY POUR L'INSTANT
// import { withSentryConfig } from '@sentry/nextjs';
import withBundleAnalyzer from '@next/bundle-analyzer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Validation des variables d'environnement
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
  ];

  const missingVars = requiredVars.filter((varName) => !process.env[varName]);

  if (missingVars.length > 0) {
    console.warn(`⚠️ Missing environment variables: ${missingVars.join(', ')}`);
    // Ne pas throw en production pour permettre le build
    if (process.env.NODE_ENV === 'production') {
      console.error(`❌ Production build requires: ${missingVars.join(', ')}`);
    }
  }
};

// Appeler la validation
validateEnv();

const bundleAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig = {
  // Désactiver l'en-tête powered-by pour la sécurité
  poweredByHeader: false,

  // Configuration des images optimisée pour Cloudinary
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
    dangerouslyAllowSVG: false,
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
    optimizeCss: true,
    // Supprimer gzipSize qui peut causer des problèmes
    // gzipSize: true,
  },

  // Configuration du compilateur pour la production
  compiler: {
    removeConsole:
      process.env.NODE_ENV === 'production'
        ? {
            exclude: ['error', 'warn'],
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

  // Configuration des en-têtes HTTP simplifiée
  async headers() {
    return [
      // API publiques avec cache
      {
        source: '/api/dashboard/(templates|applications|blog)/:path*',
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

      // APIs sensibles sans cache
      {
        source: '/api/(auth|register)/:path*',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: process.env.NEXT_PUBLIC_SITE_URL || 'same-origin',
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
            value: 'no-store, no-cache, must-revalidate',
          },
          { key: 'Pragma', value: 'no-cache' },
          { key: 'Expires', value: '0' },
        ],
      },

      // Ressources statiques
      {
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },

      {
        source: '/(images|fonts)/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=3600',
          },
        ],
      },
    ];
  },

  // Configuration des redirections simplifiée
  async redirects() {
    return [
      { source: '/home', destination: '/', permanent: true },
      {
        source: '/api/templates/:path*',
        destination: '/api/dashboard/templates/:path*',
        permanent: true,
      },
    ];
  },

  // Configuration du runtime côté serveur
  serverRuntimeConfig: {
    PROJECT_ROOT: __dirname,
  },

  // Configuration publique
  publicRuntimeConfig: {
    SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    CLOUDINARY_CLOUD_NAME: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: process.env.NEXT_PUBLIC_CLOUDINARY_API_KEY,
  },

  // Configuration Webpack simplifiée
  webpack: (config, { dev, isServer }) => {
    // Optimisations basiques pour la production
    if (!dev) {
      config.optimization = {
        ...config.optimization,
        moduleIds: 'deterministic',
        splitChunks: {
          chunks: 'all',
          cacheGroups: {
            default: {
              minChunks: 2,
              priority: -20,
              reuseExistingChunk: true,
            },
            vendor: {
              test: /[\\/]node_modules[\\/]/,
              name: 'vendors',
              priority: -10,
              chunks: 'all',
            },
          },
        },
      };

      // Cache simple
      config.cache = {
        type: 'filesystem',
        cacheDirectory: path.resolve(__dirname, '.next/cache/webpack'),
      };
    }

    // Alias pour améliorer les performances
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

  // Gestion des erreurs
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },

  // Configuration de sortie
  output: process.env.NODE_ENV === 'production' ? 'standalone' : undefined,

  // Optimisation des logs
  logging: {
    fetches: {
      fullUrl: process.env.NODE_ENV === 'development',
    },
  },
};

// Export SANS Sentry pour isoler le problème
export default bundleAnalyzer(nextConfig);

// ==========================================
// CONFIGURATION SENTRY À RÉACTIVER PLUS TARD
// ==========================================
/*
import { withSentryConfig } from '@sentry/nextjs';

const sentryWebpackPluginOptions = {
  org: process.env.SENTRY_ORG || 'your-org',
  project: process.env.SENTRY_PROJECT || 'admin-dashboard',
  authToken: process.env.SENTRY_AUTH_TOKEN,

  silent: true,
  hideSourceMaps: true,
  widenClientFileUpload: true,
  transpileClientSDK: true,
  tunnelRoute: '/monitoring',

  dryRun: !process.env.SENTRY_AUTH_TOKEN,
  debug: false,

  include: '.next',
  ignore: ['node_modules', '*.map'],

  release: process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA,
  deploy: {
    env: process.env.NODE_ENV,
  },

  automaticVercelMonitors: false,
};

export default withSentryConfig(
  bundleAnalyzer(nextConfig),
  sentryWebpackPluginOptions,
);
*/
