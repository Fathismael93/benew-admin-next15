import { NextResponse } from 'next/server';
import { getClient } from '@/utils/dbConnect';

export async function GET() {
  console.log('We are in the GET REQUEST API of orders');
  let client;
  try {
    client = await getClient();

    const result = await client.query(
      `SELECT 
        orders.order_id,
        orders.order_payment_status,
        orders.order_created,
        orders.order_price,
        applications.application_name,
        applications.application_category,
        applications.application_images
      FROM orders
      JOIN applications ON orders.order_application_id = applications.application_id
      ORDER BY orders.order_created DESC;`,
    );

    console.log('RESULT OF ORDERS', result.rows);

    await client.cleanup();
    return NextResponse.json({ orders: result.rows });
  } catch (e) {
    console.error('Error fetching orders:', e);
    if (client) await client.cleanup();

    return NextResponse.json({
      success: false,
      message: 'Something went wrong! Please try again',
    });
  }
}
