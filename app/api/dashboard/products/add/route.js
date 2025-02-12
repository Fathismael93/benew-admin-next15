import { NextResponse } from 'next/server';
import client from '../../../../../utils/dbConnect';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const formData = await req.json();

    const { name, link, description, category, fee, rent, imageUrl } = formData;

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

    if (!description || description.length < 6) {
      return NextResponse.json({
        success: false,
        message: 'Description is missing',
      });
    }

    if (!category || category.length < 6) {
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

    if (!imageUrl || imageUrl.length < 1) {
      return NextResponse.json({
        success: false,
        message: 'Image is missing',
      });
    }

    client.connect(function (err) {
      if (err) {
        console.log(err);
        throw err;
      }

      console.log('Connected To Aiven, Postgresql Database');
    });

    const addPresentation = await client.query(
      'INSERT INTO products ' +
        '(product_name, product_link, product_description, product_category, product_fee, product_rent, product_images) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [name, link, description, category, fee, rent, imageUrl],
    );

    client.end(function (err) {
      if (err) {
        console.log(err);
        throw err;
      }

      console.log('Client Connected To Aiven Postgresql Database is stopped');
    });

    if (addPresentation.rows[0]) {
      console.log(addPresentation.rows[0]);
      return NextResponse.json({
        success: true,
        message: 'Data saved successfully',
        data: addPresentation.rows[0],
      });
    }
    return NextResponse.json({
      success: false,
      message: 'Something goes wrong !Please try again',
    });
  } catch (e) {
    return NextResponse.json({
      success: false,
      message: 'Something goes wrong !Please try again',
    });
  }
}
