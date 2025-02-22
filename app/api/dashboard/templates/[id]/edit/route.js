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
      `UPDATE templates 
         SET template_name = $1,
             template_image = $2,
             template_has_web = $3,
             template_has_mobile = $4
         WHERE template_id = $5
         RETURNING *`,
      [templateName, templateImageId, templateHasWeb, templateHasMobile, id],
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
