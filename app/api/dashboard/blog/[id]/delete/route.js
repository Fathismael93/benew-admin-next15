/* eslint-disable no-unused-vars */
import { NextResponse } from 'next/server';
import { getClient } from '@backend/dbConnect';
import cloudinary from '@backend/cloudinary';

export const dynamic = 'force-dynamic';

export async function DELETE(req, { params }) {
  let client;
  console.log('WE are in the DELETE REQUEST OF SINGLE ARTICLE API');
  const { id } = await params;

  console.log('ID of the article that is being deleted !');
  console.log(id);

  if (!Number.isInteger(parseInt(id, 10))) {
    return NextResponse.json({
      success: false,
      message: 'This article does not exist',
    });
  }

  const body = await req.json();
  const imageID = body.imageID;

  try {
    client = await getClient();
    const result = await client.query(
      'DELETE FROM articles WHERE article_id=$1',
      [id],
    );

    console.log('Result after deleting article from db');
    console.log(result);

    if (result.rowCount > 0) {
      console.log('Article deleted successfully!');

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
        message: 'Article and associated image deleted successfully',
      });
    }

    if (client) await client.cleanup();

    return NextResponse.json({
      success: false,
      message: 'Something goes wrong !Please try again',
    });
  } catch (e) {
    if (client) await client.cleanup();

    return NextResponse.json({
      success: false,
      message: 'Something goes wrong !Please try again',
    });
  }
}
