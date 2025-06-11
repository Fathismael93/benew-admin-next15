// app/api/dashboard/platforms/add/route.js

import { NextResponse } from 'next/server';
import { getClient } from '@backend/dbConnect';

export async function POST(req) {
  let client;
  try {
    const formData = await req.json();
    const { platformName, platformNumber } = formData;

    if (!platformName || platformName.length < 3) {
      return NextResponse.json({
        success: false,
        message: 'Platform name is missing or too short',
      });
    }

    if (!platformNumber || platformNumber.length < 3) {
      return NextResponse.json({
        success: false,
        message: 'Platform number is missing or too short',
      });
    }

    client = await getClient();

    const addPlatform = await client.query(
      'INSERT INTO platforms (platform_name, platform_number) VALUES ($1, $2) RETURNING *',
      [platformName, platformNumber],
    );

    if (addPlatform.rows[0]) {
      await client.cleanup();
      return NextResponse.json({
        success: true,
        message: 'Platform added successfully',
        data: addPlatform.rows[0],
      });
    }

    await client.cleanup();
    return NextResponse.json({
      success: false,
      message: 'Failed to add platform. Please try again.',
    });
  } catch (e) {
    console.error('Error adding platform:', e);
    if (client) await client.cleanup();

    return NextResponse.json({
      success: false,
      message: 'Something went wrong! Please try again',
    });
  }
}
