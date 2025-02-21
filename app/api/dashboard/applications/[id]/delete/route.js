// app/api/dashboard/applications/delete/route.js

import { NextResponse } from 'next/server';
import { getClient } from '@/utils/dbConnect';

export async function DELETE(req, { params }) {
  const { id } = await params;

  let client;
  try {
    client = await getClient();

    const result = await client.query(
      'DELETE FROM applications WHERE application_id = $1 RETURNING *',
      [id],
    );

    if (result.rows[0]) {
      await client.cleanup();
      return NextResponse.json({
        success: true,
        message: 'Application deleted successfully',
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
