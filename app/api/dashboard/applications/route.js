// app/api/dashboard/applications/route.js

import { NextResponse } from 'next/server';
import { getClient } from '@backend/dbConnect';

export async function GET() {
  let client;
  try {
    client = await getClient();

    const result = await client.query(
      'SELECT application_id, application_name, application_images, application_fee, application_rent, application_link, application_type FROM applications',
    );
    const applications = result.rows;

    await client.cleanup();
    return NextResponse.json({ applications });
  } catch (e) {
    console.error('Error fetching applications:', e);
    if (client) await client.cleanup();

    return NextResponse.json({
      success: false,
      message: 'Something went wrong! Please try again',
    });
  }
}
