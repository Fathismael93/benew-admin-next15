import { NextResponse } from 'next/server';
import client from '@/utils/dbConnect';

export default async function GET() {
  try {
    const query = {
      // give the query a unique name
      name: 'get-article',
      text: "SELECT article_id, article_title, article_image, TO_CHAR(article_created,'dd/MM/yyyy') as created FROM articles ORDER BY created DESC, article_id DESC",
    };

    const getResult = await client.query(query);

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
