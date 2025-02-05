import { NextResponse } from 'next/server';
import client from '@/utils/dbConnect';

export const dynamic = 'force-dynamic';

export async function DELETE(req, params) {
  const { id } = params;

  if (!Number.isInteger(parseInt(id, 10))) {
    return NextResponse.json({
      success: false,
      message: 'This article does not exist',
    });
  }

  try {
    const result = await client.query(
      'DELETE FROM articles WHERE article_id=$1',
      [id],
    );

    client.end(function (err) {
      if (err) {
        console.log(err);
        throw err;
      }

      console.log('Client Connected To Aiven Postgresql Database is stopped');
    });

    if (result) {
      return NextResponse.json({
        success: true,
        message: 'Article deleted successfully',
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
