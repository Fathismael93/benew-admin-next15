import { NextResponse } from 'next/server';
import { getClient } from '@backend/dbConnect';

export async function POST(req) {
  let client;
  try {
    const formData = await req.json();
    const {
      name,
      link,
      description,
      category,
      fee,
      rent,
      imageUrls, // Changed to array
      templateId,
      type, // Add type here
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

    if (!imageUrls || imageUrls.length === 0) {
      // Check if at least one image is uploaded
      return NextResponse.json({
        success: false,
        message: 'At least one image is required',
      });
    }

    // Add validation for type
    if (!type || type.length < 2) {
      return NextResponse.json({
        success: false,
        message: 'Application type is missing',
      });
    }

    if (!templateId) {
      return NextResponse.json({
        success: false,
        message: 'Template ID is missing',
      });
    }

    client = await getClient();

    // Update the INSERT query to include application_type
    const addApplication = await client.query(
      'INSERT INTO applications ' +
        '(application_name, application_link, application_description, application_category, application_fee, application_rent, application_images, application_template_id, application_type) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
      [
        name,
        link,
        description,
        category,
        fee,
        rent,
        imageUrls,
        templateId,
        type,
      ], // Add type here
    );

    if (addApplication.rows[0]) {
      await client.cleanup();
      return NextResponse.json({
        success: true,
        message: 'Application added successfully !',
        data: addApplication.rows[0],
      });
    }

    await client.cleanup();
    return NextResponse.json({
      success: false,
      message: 'Failed to add application. Please try again.',
    });
  } catch (e) {
    console.error('Error adding application:', e);
    if (client) await client.cleanup();

    return NextResponse.json({
      success: false,
      message: 'Something went wrong! Please try again',
    });
  }
}
