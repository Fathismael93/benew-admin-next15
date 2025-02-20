import { v2 as cloudinary } from 'cloudinary';
import { NextResponse } from 'next/server';

export async function POST(req) {
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

    return NextResponse.json({ signature });
  } catch (error) {
    console.error('Error generating Cloudinary signature:', error);
    return NextResponse.json(
      { error: 'Failed to generate signature' },
      { status: 500 },
    );
  }
}
