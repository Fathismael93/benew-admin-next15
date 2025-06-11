import { NextResponse } from 'next/server';
import { getClient } from '@backend/dbConnect';

export async function GET() {
  console.log('we are in the GET REQUEST of the templates api');
  const client = await getClient();
  try {
    try {
      const result = await client.query(
        'SELECT template_id, template_name, template_image, template_has_web, template_has_mobile FROM templates ORDER BY template_added DESC',
      );

      console.log('result: ');
      console.log(result);

      return NextResponse.json({ templates: result.rows }, { status: 200 });
    } finally {
      await client.cleanup();
    }
  } catch (error) {
    await client.cleanup();
    console.error('Error fetching templates:', error);

    return NextResponse.json(
      { message: 'Failed to fetch templates', error: error.message },
      { status: 500 },
    );
  }
}
