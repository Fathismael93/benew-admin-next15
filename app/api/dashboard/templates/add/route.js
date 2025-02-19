// app/api/templates/route.js
import { NextResponse } from 'next/server';
import { Pool } from 'pg';

// Create PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
});

export async function POST(request) {
  try {
    const body = await request.json();
    const {
      templateName,
      templateImage,
      templateImageId,
      templateHasWeb,
      templateHasMobile,
    } = body;

    // Validate required fields
    if (!templateName || !templateImage) {
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
        template_image_id,
        template_has_web,
        template_has_mobile
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING template_id
    `;

    const values = [
      templateName,
      templateImage,
      templateImageId || null,
      templateHasWeb === undefined ? true : templateHasWeb,
      templateHasMobile === undefined ? false : templateHasMobile,
    ];

    const client = await pool.connect();

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
      client.release();
    }
  } catch (error) {
    console.error('Error adding template:', error);

    return NextResponse.json(
      { message: 'Failed to add template', error: error.message },
      { status: 500 },
    );
  }
}
