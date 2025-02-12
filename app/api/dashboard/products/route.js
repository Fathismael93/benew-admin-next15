import { NextResponse } from 'next/server';
import client from '@/utils/dbConnect';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    client.connect(function (err) {
      if (err) {
        console.log(err);
        throw err;
      }

      console.log('Connected To Aiven, Postgresql Database');
    });

    const result = await client.query(
      'SELECT product_id, product_name, product_link, product_description, product_category, product_fee, product_rent, product_images FROM products',
    );

    client.end(function (err) {
      if (err) {
        console.log(err);
        throw err;
      }

      console.log('Client Connected To Aiven Postgresql Database is stopped');
    });

    if (result.rows[0]) {
      return NextResponse.json({
        success: true,
        message: 'Data saved successfully',
        data: result,
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
