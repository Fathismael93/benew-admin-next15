import path, { dirname } from 'path';
import { fileURLToPath } from 'url';

// CONFIGURATION MINIMALE POUR FAIRE FONCTIONNER LE BUILD
import withBundleAnalyzer from '@next/bundle-analyzer';
import { withSentryConfig } from '@sentry/nextjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const bundleAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig = {
  poweredByHeader: false,

  // AJOUTS CRITIQUES POUR LA PRODUCTION
  reactStrictMode: true,
  swcMinify: true,
  compress: true,

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
    // AJOUTS pour la sécurité et performance
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 60,
    dangerouslyAllowSVG: false,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },

  experimental: {
    // AJOUTS pour les performances
    optimizeCss: true,
    serverComponentsExternalPackages: ['@prisma/client', 'bcryptjs'],
  },

  compiler: {
    removeConsole:
      process.env.NODE_ENV === 'production'
        ? {
            exclude: ['error', 'warn'],
          }
        : false,
  },

  async headers() {
    // HEADERS DE SÉCURITÉ CRITIQUES MANQUANTS
    const securityHeaders = [
      { key: 'X-DNS-Prefetch-Control', value: 'on' },
      {
        key: 'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains; preload',
      },
      { key: 'X-XSS-Protection', value: '1; mode=block' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'origin-when-cross-origin' },
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=()',
      },
      {
        key: 'Content-Security-Policy',
        value:
          "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests;",
      },
    ];

    return [
      // SÉCURITÉ GLOBALE
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
      {
        source: '/api/dashboard/(templates|applications|blog)/:path*',
        headers: [
          ...securityHeaders,
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
            value: 'Content-Type, Authorization',
          },
          // CACHE OPTIMISÉ
          {
            key: 'Cache-Control',
            value:
              'public, max-age=300, s-maxage=600, stale-while-revalidate=86400',
          },
        ],
      },
      {
        source: '/api/(auth|register)/:path*',
        headers: [
          ...securityHeaders,
          {
            key: 'Access-Control-Allow-Origin',
            value: process.env.NEXT_PUBLIC_SITE_URL || 'same-origin',
          },
          { key: 'Access-Control-Allow-Methods', value: 'POST, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate, proxy-revalidate',
          },
          // SÉCURITÉ AUTH RENFORCÉE
          { key: 'Pragma', value: 'no-cache' },
          { key: 'Expires', value: '0' },
        ],
      },
      {
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      // CACHE IMAGES OPTIMISÉ
      {
        source: '/_next/image/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=2592000, stale-while-revalidate=86400',
          },
        ],
      },
    ];
  },

  async redirects() {
    return [
      { source: '/home', destination: '/', permanent: true },
      // REDIRECTION HTTPS FORCÉE EN PRODUCTION
      ...(process.env.NODE_ENV === 'production'
        ? [
            {
              source: '/:path*',
              has: [
                { type: 'header', key: 'x-forwarded-proto', value: 'http' },
              ],
              destination: 'https://your-domain.com/:path*',
              permanent: true,
            },
          ]
        : []),
    ];
  },

  webpack: (config, { isServer, dev, buildId }) => {
    // Configuration minimale pour éviter les erreurs
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': path.resolve(__dirname),
      // ALIAS OPTIMISÉS AJOUTÉS
      '@/ui': path.resolve(__dirname, 'ui'),
      '@/utils': path.resolve(__dirname, 'utils'),
    };

    if (isServer) {
      // EXTERNALS ÉTENDUS POUR LA SÉCURITÉ
      config.externals = [
        ...config.externals,
        'pg-native',
        'sqlite3',
        'better-sqlite3',
        'mysql2',
        'bcryptjs',
      ];
    }

    // OPTIMISATIONS PRODUCTION
    if (!dev) {
      config.optimization = {
        ...config.optimization,
        splitChunks: {
          chunks: 'all',
          cacheGroups: {
            vendor: {
              test: /[\\/]node_modules[\\/]/,
              name: 'vendors',
              chunks: 'all',
            },
          },
        },
      };
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

  // AJOUTS CRITIQUES POUR LA PRODUCTION
  async generateBuildId() {
    return process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || null;
  },
};

// Options de configuration Sentry
const sentryWebpackPluginOptions = {
  // Pour les nouvelles versions de Sentry, utilisez authToken au lieu de silent
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Seulement upload les source maps en production
  widenClientFileUpload: true,
  transpileClientSDK: true,
  tunnelRoute: '/monitoring',
  hideSourceMaps: true,
  disableLogger: true,
  automaticVercelMonitors: true,
};

// Appliquer les configurations dans l'ordre : bundleAnalyzer puis Sentry
export default withSentryConfig(
  bundleAnalyzer(nextConfig),
  sentryWebpackPluginOptions,
);
