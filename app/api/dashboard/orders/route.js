import { NextResponse } from 'next/server';
import { getClient } from '@/utils/dbConnect';

export async function GET() {
  console.log('We are in the GET REQUEST API of orders');
  let client;
  try {
    client = await getClient();

    const result = await client.query(
      'SELECT ' +
        'orders.*, applications.*, platforms.* FROM orders ' +
        'JOIN applications ON orders.order_application_id = applications.application_id ' +
        'JOIN platforms ON orders.order_platform_id = platforms.platform_id ' +
        'ORDER BY orders.order_created DESC; -- Sort by most recent to least recent',
    );

    console.log('RESULT OF ORDERS');
    console.log(result);

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
