// app/api/templates/route.js
import { NextResponse } from 'next/server';
import { getClient } from '@/utils/dbConnect';

export async function POST(request) {
  const client = await getClient();
  try {
    const body = await request.json();
    const { templateName, templateImageId, templateHasWeb, templateHasMobile } =
      body;

    // Validate required fields
    if (!templateName || !templateImageId) {
      await client.cleanup();

      return NextResponse.json(
        { message: 'Template name and image are required' },
        { status: 400 },
      );
    }

    // Insert new template into database
    const queryText = `
      INSERT INTO templates (
        template_name,
        template_image,
        template_has_web,
        template_has_mobile
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING template_id
    `;

    const values = [
      templateName,
      templateImageId || null,
      templateHasWeb === undefined ? true : templateHasWeb,
      templateHasMobile === undefined ? false : templateHasMobile,
    ];

    try {
      const result = await client.query(queryText, values);
      const newTemplateId = result.rows[0].template_id;

      return NextResponse.json(
        {
          message: 'Template added successfully',
          templateId: newTemplateId,
        },
        { status: 201 },
      );
    } finally {
      await client.cleanup();
    }
  } catch (error) {
    await client.cleanup();

    console.error('Error adding template:', error);

    return NextResponse.json(
      { message: 'Failed to add template', error: error.message },
      { status: 500 },
    );
  }
}
