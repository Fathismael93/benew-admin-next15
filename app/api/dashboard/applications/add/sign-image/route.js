import { v2 as cloudinary } from 'cloudinary';
import { NextResponse } from 'next/server';

export async function POST(req) {
  console.log('POST REQUEST OF ADDING IMAGE APPLICATIONS');
  try {
    const body = await req.json();
    const { paramsToSign } = body;

    cloudinary.config({
      cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
      api_key: process.env.NEXT_PUBLIC_CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });

    paramsToSign.folder = 'applications';

    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      process.env.CLOUDINARY_API_SECRET,
    );

    return NextResponse.json(
      { signature },
      {
        status: 200,
        headers: {
          // ===== HEADERS COMMUNS (sécurité de base) =====
          'Access-Control-Allow-Origin':
            process.env.NEXT_PUBLIC_SITE_URL || 'same-origin',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers':
            'Content-Type, Authorization, X-Requested-With',

          // Anti-cache strict pour les signatures (sécurité)
          'Cache-Control':
            'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
          Pragma: 'no-cache',
          Expires: '0',
          'Surrogate-Control': 'no-store', // Empêche cache CDN/proxy

          // Sécurité de base
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'X-XSS-Protection': '1; mode=block',
          'Strict-Transport-Security':
            'max-age=31536000; includeSubDomains; preload',

          // Isolation moderne
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'credentialless',

          // ===== HEADERS SPÉCIFIQUES À SIGN-IMAGE =====
          // Sécurité renforcée pour manipulation de secrets API
          'Referrer-Policy': 'no-referrer', // Plus strict - évite leak de signature
          'Cross-Origin-Resource-Policy': 'same-origin', // Plus strict que same-site

          // CSP ultra restrictif pour API de signature
          'Content-Security-Policy': "default-src 'none'",

          // Permissions limitées
          'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',

          // ===== HEADERS CLOUDINARY SPÉCIFIQUES =====
          'X-Upload-Folder': 'applications',
          'X-API-Type': 'signature-generation',
          'X-Media-Service': 'cloudinary',

          // ===== HEADERS MÉTIER COMMUNS =====
          'X-API-Version': '1.0',
          'X-Transaction-Type': 'mutation',
          'X-Entity-Type': 'application',
        },
      },
    );
  } catch (error) {
    console.error('Error generating Cloudinary signature:', error);

    return NextResponse.json(
      { error: 'Failed to generate signature' },
      {
        status: 500,
        headers: {
          // ===== MÊME HEADERS DE SÉCURITÉ EN CAS D'ERREUR =====
          'Access-Control-Allow-Origin':
            process.env.NEXT_PUBLIC_SITE_URL || 'same-origin',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers':
            'Content-Type, Authorization, X-Requested-With',

          // Anti-cache strict
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
          Expires: '0',
          'Surrogate-Control': 'no-store',

          // Sécurité renforcée (même en erreur)
          'Referrer-Policy': 'no-referrer',
          'Cross-Origin-Resource-Policy': 'same-origin',
          'Content-Security-Policy': "default-src 'none'",
          'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',

          // Sécurité de base
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'X-XSS-Protection': '1; mode=block',
          'Strict-Transport-Security':
            'max-age=31536000; includeSubDomains; preload',

          // Isolation
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'credentialless',

          // Headers métier (même en erreur)
          'X-API-Version': '1.0',
          'X-Transaction-Type': 'mutation',
          'X-Entity-Type': 'application',
          'X-API-Type': 'signature-generation',
          'X-Error-Context': 'cloudinary-signature-failed',
        },
      },
    );
  }
}
