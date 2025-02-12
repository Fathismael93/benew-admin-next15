import { NextResponse } from 'next/server';
import client from '@/utils/dbConnect';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const query = {
      // give the query a unique name
      name: 'get-presentation',
      text: 'SELECT presentation_id, presentation_name, presentation_title, presentation_text FROM presentations',
    };

    client.connect(function (err) {
      if (err) {
        console.log(err);
        throw err;
      }

      console.log('Connected To Aiven, Postgresql Database');
    });

    const getResult = await client.query(query);

    if (getResult) {
      client.end(function (err) {
        if (err) {
          console.log(err);
          throw err;
        }

        console.log('Client Database is stopped');
      });
    }

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
