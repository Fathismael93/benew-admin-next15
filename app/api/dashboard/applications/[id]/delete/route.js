// app/api/dashboard/applications/delete/route.js

import { NextResponse } from 'next/server';
import { getClient } from '@backend/dbConnect';
import cloudinary from '@backend/cloudinary';

export async function DELETE(req) {
  let client;
  try {
    const { id, application_images } = await req.json(); // Get id and application_images from the body

    if (!id) {
      return NextResponse.json({
        success: false,
        message: 'Application ID is missing',
      });
    }

    client = await getClient();

    // Delete images from Cloudinary
    if (application_images && application_images.length > 0) {
      for (const publicId of application_images) {
        try {
          await cloudinary.uploader.destroy(publicId);
          console.log(`Deleted image from Cloudinary: ${publicId}`);
        } catch (error) {
          console.error(
            `Error deleting image from Cloudinary: ${publicId}`,
            error,
          );
        }
      }
    }

    // Delete the application from the database
    const deleteResult = await client.query(
      'DELETE FROM applications WHERE application_id = $1 RETURNING *',
      [id],
    );

    if (deleteResult.rows[0]) {
      await client.cleanup();
      return NextResponse.json({
        success: true,
        message: 'Application and associated images deleted successfully',
      });
    }

    await client.cleanup();
    return NextResponse.json({
      success: false,
      message: 'Failed to delete application. Please try again.',
    });
  } catch (e) {
    console.error('Error deleting application:', e);
    if (client) await client.cleanup();

    return NextResponse.json({
      success: false,
      message: 'Something went wrong! Please try again',
    });
  }
}
