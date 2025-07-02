import cloudinary from '@backend/cloudinary';
import { NextResponse } from 'next/server';
import { limitRequest } from '@backend/rateLimiter';

export const POST = async (req) => {
  try {
    // Get IP Address for rate limiting (works in Vercel & Next.js)
    const ip = req.headers.get('x-forwarded-for') || 'local';

    if (!limitRequest(ip)) {
      return NextResponse.json(
        { error: 'Too many requests' },
        {
          status: 429,
          headers: {
            // Headers de sécurité même en cas d'erreur de rate limiting
            'Access-Control-Allow-Origin':
              process.env.NEXT_PUBLIC_SITE_URL || 'same-origin',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'Referrer-Policy': 'no-referrer',
            'Cross-Origin-Resource-Policy': 'same-origin',
            'Content-Security-Policy':
              "default-src 'none'; connect-src 'self' https://api.cloudinary.com",
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
          },
        },
      );
    }

    const body = await req.json();
    const { paramsToSign } = body;

    if (!paramsToSign) {
      return NextResponse.json(
        { error: 'Missing paramsToSign' },
        {
          status: 400,
          headers: {
            // Headers de sécurité même en cas d'erreur de validation
            'Access-Control-Allow-Origin':
              process.env.NEXT_PUBLIC_SITE_URL || 'same-origin',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'Referrer-Policy': 'no-referrer',
            'Cross-Origin-Resource-Policy': 'same-origin',
            'Content-Security-Policy':
              "default-src 'none'; connect-src 'self' https://api.cloudinary.com",
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
          },
        },
      );
    }

    // Add the folder parameter to paramsToSign
    paramsToSign.folder = 'blog_pictures';

    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      process.env.CLOUDINARY_API_SECRET,
    );

    console.log('Generated Cloudinary Signature:', signature);

    return NextResponse.json(
      { signature },
      {
        status: 200,
        headers: {
          // ===== CORS SPÉCIFIQUE CLOUDINARY =====
          'Access-Control-Allow-Origin':
            process.env.NEXT_PUBLIC_SITE_URL || 'same-origin',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers':
            'Content-Type, Authorization, X-Requested-With',

          // ===== ANTI-CACHE STRICT (signatures sensibles) =====
          'Cache-Control':
            'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
          Pragma: 'no-cache',
          Expires: '0',
          'Surrogate-Control': 'no-store', // Empêche cache CDN/proxy

          // ===== SÉCURITÉ RENFORCÉE POUR SIGNATURES =====
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'X-XSS-Protection': '1; mode=block',
          'Strict-Transport-Security':
            'max-age=31536000; includeSubDomains; preload',

          // ===== ISOLATION ET POLICIES =====
          'Referrer-Policy': 'no-referrer', // Plus strict - évite leak de signature
          'Cross-Origin-Resource-Policy': 'same-origin', // Plus strict que same-site
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'credentialless',

          // ===== CSP RESTRICTIF POUR API DE SIGNATURE =====
          'Content-Security-Policy':
            "default-src 'none'; connect-src 'self' https://api.cloudinary.com",

          // ===== PERMISSIONS LIMITÉES =====
          'Permissions-Policy':
            'camera=(), microphone=(), geolocation=(), payment=(), usb=()',

          // ===== HEADERS INFORMATIFS SPÉCIFIQUES BLOG =====
          'X-Upload-Folder': 'blog_pictures',
          'X-API-Type': 'signature-generation',
          'X-Entity-Type': 'blog-article',
          'X-Operation-Type': 'image-upload-signature',

          // ===== HEADERS MÉTIER BLOG =====
          'X-API-Version': '1.0',
          'X-Transaction-Type': 'signature',
          'X-Service-Integration': 'cloudinary',

          // ===== SÉCURITÉ SUPPLÉMENTAIRE =====
          'X-Permitted-Cross-Domain-Policies': 'none',
          Vary: 'Authorization, Content-Type',

          // ===== HEADERS DE DEBUGGING/MONITORING =====
          'X-Content-Category': 'blog-media',
          'X-Upload-Context': 'article-creation',
        },
      },
    );
  } catch (error) {
    console.error('Cloudinary Signature Error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      {
        status: 500,
        headers: {
          // Headers de sécurité même en cas d'erreur serveur
          'Access-Control-Allow-Origin':
            process.env.NEXT_PUBLIC_SITE_URL || 'same-origin',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Referrer-Policy': 'no-referrer',
          'Cross-Origin-Resource-Policy': 'same-origin',
          'Content-Security-Policy':
            "default-src 'none'; connect-src 'self' https://api.cloudinary.com",
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'X-XSS-Protection': '1; mode=block',
          'Strict-Transport-Security':
            'max-age=31536000; includeSubDomains; preload',
          'X-Permitted-Cross-Domain-Policies': 'none',
        },
      },
    );
  }
};

export const config = {
  matcher: '/api/signature', // Ensures it runs only on this route
};
