/* eslint-disable no-unused-vars */
import { NextResponse } from 'next/server';
import { getClient } from '@backend/dbConnect';

export async function PUT(req, { params }) {
  const { id } = await params;
  let client;

  try {
    const formData = await req.json();
    const {
      name,
      link,
      description,
      category,
      type,
      fee,
      rent,
      imageUrls,
      otherVersions,
    } = formData;

    if (!name || name.length < 3) {
      return NextResponse.json({
        success: false,
        message: 'Name is missing',
      });
    }

    if (!link || link.length < 6) {
      return NextResponse.json({
        success: false,
        message: 'Link is missing',
      });
    }

    if (!category) {
      return NextResponse.json({
        success: false,
        message: 'Category is missing',
      });
    }

    if (!fee || fee === 0) {
      return NextResponse.json({
        success: false,
        message: 'Fee is missing',
      });
    }

    if (!rent || rent < 0) {
      return NextResponse.json({
        success: false,
        message: 'Rent is missing',
      });
    }

    if (!type) {
      return NextResponse.json({
        success: false,
        message: 'Application type is missing',
      });
    }

    if (!imageUrls || imageUrls.length === 0) {
      return NextResponse.json({
        success: false,
        message: 'At least one image is required',
      });
    }

    client = await getClient();

    const updateApplication = await client.query(
      'UPDATE applications SET ' +
        'application_name = $1, ' +
        'application_link = $2, ' +
        'application_description = $3, ' +
        'application_category = $4, ' +
        'application_type = $5, ' + // Added application_type
        'application_fee = $6, ' +
        'application_rent = $7, ' +
        'application_images = $8, ' +
        'application_other_versions = $9 ' +
        'WHERE application_id = $10 RETURNING *',
      [
        name,
        link,
        description,
        category,
        type, // Include type in query
        fee,
        rent,
        imageUrls,
        otherVersions,
        id,
      ],
    );

    if (updateApplication.rows[0]) {
      await client.cleanup();
      return NextResponse.json({
        success: true,
        message: 'Application updated successfully',
        data: updateApplication.rows[0],
      });
    }

    await client.cleanup();
    return NextResponse.json({
      success: false,
      message: 'Failed to update application. Please try again.',
    });
  } catch (e) {
    console.error('Error updating application:', e);
    if (client) await client.cleanup();

    return NextResponse.json({
      success: false,
      message: 'Something went wrong! Please try again',
    });
  }
}
