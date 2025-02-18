import { NextResponse } from 'next/server';
import { getClient } from '@/utils/dbConnect';

export async function GET() {
  const client = await getClient();

  try {
    const result = await client.query(
      'SELECT product_id, product_name, product_link, product_description, product_category, product_fee, product_rent, product_images FROM products',
    );

    if (result.rows[0]) {
      if (client) await client.cleanup();

      return NextResponse.json({
        success: true,
        message: 'Data saved successfully',
        data: result,
      });
    }

    if (client) await client.cleanup();

    return NextResponse.json({
      success: false,
      message: 'Something goes wrong !Please try again',
    });
  } catch (e) {
    if (client) await client.cleanup();

    return NextResponse.json({
      success: false,
      message: 'Something goes wrong !Please try again',
    });
  }
}
