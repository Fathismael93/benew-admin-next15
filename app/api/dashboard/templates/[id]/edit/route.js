import cloudinary from '@backend/cloudinary';
import { getClient } from '@backend/dbConnect';
import { NextResponse } from 'next/server';

export async function PUT(request, { params }) {
  const { id } = params;
  const client = await getClient();

  try {
    const body = await request.json();
    const {
      templateName,
      templateImageId,
      templateHasWeb,
      templateHasMobile,
      isActive,
      oldImageId,
    } = body;

    if (!templateName || !templateImageId) {
      return NextResponse.json(
        { message: 'Template name and image are required' },
        { status: 400 },
      );
    }

    // If image has changed, delete old image from Cloudinary
    if (oldImageId && oldImageId !== templateImageId) {
      try {
        await cloudinary.uploader.destroy(oldImageId);
      } catch (cloudError) {
        console.error('Error deleting old image from Cloudinary:', cloudError);
      }
    }

    const result = await client.query(
      `UPDATE catalog.templates 
         SET template_name = $1,
             template_image = $2,
             template_has_web = $3,
             template_has_mobile = $4,
             is_active = $5,
         WHERE template_id = $6
         RETURNING *`,
      [
        templateName,
        templateImageId,
        templateHasWeb,
        templateHasMobile,
        isActive,
        id,
      ],
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { message: 'Template not found' },
        { status: 404 },
      );
    }

    return NextResponse.json(
      {
        message: 'Template updated successfully',
        template: result.rows[0],
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('Error updating template:', error);
    return NextResponse.json(
      { message: 'Failed to update template', error: error.message },
      { status: 500 },
    );
  } finally {
    await client.cleanup();
  }
}
