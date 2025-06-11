// app/api/dashboard/applications/[id]/route.js

import { NextResponse } from 'next/server';
import { getClient } from '@backend/dbConnect';

export async function GET(req, { params }) {
  const { id } = params;
  let client;

  try {
    client = await getClient();

    const result = await client.query(
      'SELECT * FROM applications WHERE application_id = $1',
      [id],
    );

    if (result.rows.length === 0) {
      await client.cleanup();
      return NextResponse.json({
        success: false,
        message: 'Application not found',
      });
    }

    const application = result.rows[0];
    await client.cleanup();

    return NextResponse.json({ application });
  } catch (e) {
    console.error('Error fetching application:', e);
    if (client) await client.cleanup();

    return NextResponse.json({
      success: false,
      message: 'Something went wrong! Please try again',
    });
  }
}
