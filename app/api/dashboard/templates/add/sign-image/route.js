import cloudinary from '@backend/cloudinary';
import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    // Get the params that Cloudinary needs to generate a signature
    const body = await request.json();
    const { paramsToSign } = body;

    // Add the folder parameter to paramsToSign
    paramsToSign.folder = 'templates';

    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      process.env.CLOUDINARY_API_SECRET,
    );

    return NextResponse.json(
      { signature },
      {
        status: 200,
        headers: {
          // CORS spécifique - plus restrictif pour les signatures
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

          // Sécurité renforcée pour manipulation de secrets API
          'Referrer-Policy': 'no-referrer', // Plus strict - évite leak de signature
          'Cross-Origin-Resource-Policy': 'same-origin', // Plus strict que same-site

          // CSP restrictif pour API de signature
          'Content-Security-Policy': "default-src 'none'",

          // Permissions limitées
          'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',

          // Headers informatifs spécifiques Cloudinary
          'X-Upload-Folder': 'templates',
          'X-API-Type': 'signature-generation',
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
          // Même headers de sécurité en cas d'erreur
          'Access-Control-Allow-Origin':
            process.env.NEXT_PUBLIC_SITE_URL || 'same-origin',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Referrer-Policy': 'no-referrer',
          'Cross-Origin-Resource-Policy': 'same-origin',
          'Content-Security-Policy': "default-src 'none'",
        },
      },
    );
  }
}
