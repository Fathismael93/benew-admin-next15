import { NextResponse } from 'next/server';
import client from '@/utils/dbConnect';

export const dynamic = 'force-dynamic';

export async function DELETE(req, { params }) {
  console.log('WE are in the DELETE REQUEST OF SINGLE ARTICLE API');
  const { id } = await params;

  if (!Number.isInteger(parseInt(id, 10))) {
    return NextResponse.json({
      success: false,
      message: 'This article does not exist',
    });
  }

  const body = req.body;

  console.log('body: ');
  console.log(body);

  // try {
  //   const result = await client.query(
  //     'DELETE FROM articles WHERE article_id=$1',
  //     [id],
  //   );

  //   if (result) {
  //     return NextResponse.json({
  //       success: true,
  //       message: 'Article deleted successfully',
  //     });
  //   }
  //   return NextResponse.json({
  //     success: false,
  //     message: 'Something goes wrong !Please try again',
  //   });
  // } catch (e) {
  //   return NextResponse.json({
  //     success: false,
  //     message: 'Something goes wrong !Please try again',
  //   });
  // }
}
