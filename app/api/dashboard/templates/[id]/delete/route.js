import { NextResponse } from 'next/server';
import { getClient } from '@backend/dbConnect';
import cloudinary from '@backend/cloudinary';

export const dynamic = 'force-dynamic';

export async function DELETE(req, { params }) {
  console.log('We are in the DELETE REQUEST of the Template API');
  const { id } = await params;

  if (!Number.isInteger(parseInt(id, 10))) {
    return NextResponse.json({
      success: false,
      message: 'This template does not exist',
    });
  }

  const body = await req.json();
  const imageID = body.imageID;

  let client;

  try {
    client = await getClient();
    const result = await client.query(
      'DELETE FROM templates WHERE template_id=$1',
      [id],
    );

    if (result.rowCount > 0) {
      console.log('Template deleted successfully!');

      // Delete image from Cloudinary
      if (imageID) {
        try {
          await cloudinary.uploader.destroy(imageID);
          console.log('Image deleted from Cloudinary successfully');
        } catch (cloudError) {
          console.error('Error deleting image from Cloudinary:', cloudError);
        }
      }

      if (client) await client.cleanup();

      return NextResponse.json({
        success: true,
        message: 'Template and associated image deleted successfully',
      });
    }

    if (client) await client.cleanup();

    return NextResponse.json({
      success: false,
      message: 'Something went wrong! Please try again',
    });
  } catch (e) {
    console.error('Error deleting template:', e);
    if (client) await client.cleanup();

    return NextResponse.json({
      success: false,
      message: 'Something went wrong! Please try again',
    });
  }
}
