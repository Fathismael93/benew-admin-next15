import cloudinary from '@/utils/cloudinary';
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

    return NextResponse.json({ signature });
  } catch (error) {
    console.error('Error generating Cloudinary signature:', error);
    return NextResponse.json(
      { error: 'Failed to generate signature' },
      { status: 500 },
    );
  }
}
