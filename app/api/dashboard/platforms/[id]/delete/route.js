// app/api/dashboard/platforms/delete/route.js

import { NextResponse } from 'next/server';
import { getClient } from '@backend/dbConnect';

export async function DELETE(req, { params }) {
  const { id } = params;

  let client;
  try {
    if (!id) {
      return NextResponse.json({
        success: false,
        message: 'Platform ID is missing',
      });
    }

    client = await getClient();

    const deleteResult = await client.query(
      'DELETE FROM admin.platforms WHERE platform_id = $1 RETURNING *',
      [id],
    );

    if (deleteResult.rows[0]) {
      await client.cleanup();
      return NextResponse.json({
        success: true,
        message: 'Platform deleted successfully',
      });
    }

    await client.cleanup();
    return NextResponse.json({
      success: false,
      message: 'Failed to delete platform. Please try again.',
    });
  } catch (e) {
    console.error('Error deleting platform:', e);
    if (client) await client.cleanup();

    return NextResponse.json({
      success: false,
      message: 'Something went wrong! Please try again',
    });
  }
}
