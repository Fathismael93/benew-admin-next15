import { NextResponse } from 'next/server';
import { getClient } from '@backend/dbConnect';

export async function POST(req) {
  let client;
  try {
    const { orderId, order_payment_status } = await req.json();

    client = await getClient();

    await client.query(
      `UPDATE admin.orders 
       SET order_payment_status = $1 
       WHERE order_id = $2;`,
      [order_payment_status, orderId],
    );

    await client.cleanup();

    return NextResponse.json({
      success: true,
      message: 'Order status updated successfully',
    });
  } catch (error) {
    console.error('Error updating order status:', error);
    if (client) await client.cleanup();

    return NextResponse.json(
      { success: false, message: 'Failed to update order status' },
      { status: 500 },
    );
  }
}
