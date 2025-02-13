import { NextResponse } from 'next/server';
import pool from '@/utils/dbConnect';

export async function GET() {
  try {
    const query = {
      // give the query a unique name
      name: 'get-presentation',
      text: 'SELECT presentation_id, presentation_name, presentation_title, presentation_text FROM presentations',
    };

    const getResult = await pool.query(query);

    return NextResponse.json(
      {
        success: true,
        data: getResult,
      },
      { status: 200 },
    );
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        message: 'Something goes wrong !Please try again',
      },
      { status: 500 },
    );
  }
}
