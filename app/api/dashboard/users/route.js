import { NextResponse } from 'next/server';
import { getClient } from '@backend/dbConnect';

export async function GET() {
  let client;
  try {
    client = await getClient();

    const query = `SELECT * FROM users`;

    // const query = `SELECT * FROM articles`;

    console.log('We prepared the query');

    const { rows } = await client.query(query);

    console.log('result in the await client.query: : ');
    console.log(rows);

    if (rows) await client.cleanup();

    return NextResponse.json(
      {
        success: true,
        users: rows || [], // Ensuring a default empty array if no articles are found
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 's-maxage=60, stale-while-revalidate=120', // Improves performance
        },
      },
    );
  } catch (error) {
    if (client) await client.cleanup();
    console.error('Database Error:', error);

    return NextResponse.json(
      {
        success: false,
        message: 'Unable to fetch users at the moment. Please try again later.',
      },
      { status: 500 },
    );
  }
}
