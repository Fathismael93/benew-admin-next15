// app/api/dashboard/templates/[id]/route.js
import { NextResponse } from 'next/server';
import { getClient } from '@backend/dbConnect';

export async function GET(req, { params }) {
  const { id } = params;
  const client = await getClient();

  try {
    const result = await client.query(
      'SELECT * FROM catalohg.templates WHERE template_id = $1',
      [id],
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { message: 'Template not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({ template: result.rows[0] }, { status: 200 });
  } catch (error) {
    console.error('Error fetching template:', error);
    return NextResponse.json(
      { message: 'Failed to fetch template', error: error.message },
      { status: 500 },
    );
  } finally {
    await client.cleanup();
  }
}
