import { NextResponse } from 'next/server';
import client from '@/utils/dbConnect';

export const dynamic = 'force-dynamic';

export async function DELETE(req, { params }) {
  console.log('We are in the DELETE REQUEST of the Template API');
  const { id } = await params;

  if (!Number.isInteger(parseInt(id, 10))) {
    return NextResponse.json({
      success: false,
      message: 'This template does not exist',
    });
  }

  try {
    const result = await client.query(
      'DELETE FROM templates WHERE template_id=$1',
      [id],
    );

    if (result) {
      console.log('Template deleted successfully !');
      return NextResponse.json({
        success: true,
        message: 'Template deleted successfully',
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
