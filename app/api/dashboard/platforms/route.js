// app/api/dashboard/platforms/route.js

import { NextResponse } from 'next/server';
import { getClient } from '@backend/dbConnect';

export async function GET() {
  console.log('We are in the GET REQUEST API of platforms');
  let client;
  try {
    client = await getClient();

    const result = await client.query('SELECT * FROM platforms');
    const platforms = result.rows;

    console.log('PLATFORMS');
    console.log(platforms);

    await client.cleanup();
    return NextResponse.json({ platforms });
  } catch (e) {
    console.error('Error fetching platforms:', e);
    if (client) await client.cleanup();

    return NextResponse.json({
      success: false,
      message: 'Something went wrong! Please try again',
    });
  }
}
