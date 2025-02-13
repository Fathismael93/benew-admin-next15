import { NextResponse } from 'next/server';
import client from '@/utils/dbConnect';

export async function GET() {
  try {
    const result = await client.query(
      'SELECT product_id, product_name, product_link, product_description, product_category, product_fee, product_rent, product_images FROM products',
    );

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
