import cloudinary from '@/utils/cloudinary';
import { NextResponse } from 'next/server';
import { limitRequest } from '@/utils/rateLimiter';

export const POST = async (req) => {
  try {
    // Get IP Address for rate limiting (works in Vercel & Next.js)
    const ip = req.headers.get('x-forwarded-for') || 'local';

    if (!limitRequest(ip)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const body = await req.json();
    const { paramsToSign } = body;

    if (!paramsToSign) {
      return NextResponse.json(
        { error: 'Missing paramsToSign' },
        { status: 400 },
      );
    }

    // Add the folder parameter to paramsToSign
    paramsToSign.folder = 'blog_pictures';

    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      process.env.CLOUDINARY_API_SECRET,
    );

    return NextResponse.json({ signature });
  } catch (error) {
    console.error('Cloudinary Signature Error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
};

export const config = {
  matcher: '/api/signature', // Ensures it runs only on this route
};
