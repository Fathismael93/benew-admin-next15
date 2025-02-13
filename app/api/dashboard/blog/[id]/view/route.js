import { NextResponse } from 'next/server';
import client from '@/utils/dbConnect';
import { articleIDSchema } from '@/utils/schemas';

export const dynamic = 'force-dynamic';

export async function GET(req, { params }) {
  try {
    const { id } = await params;

    try {
      await articleIDSchema.validate({ id });

      const query = {
        // give the query a unique name
        name: 'get-single-article',
        text: "SELECT article_id, article_title, article_text, article_image, TO_CHAR(article_created,'dd/MM/yyyy') as created FROM articles WHERE article_id=$1",
        values: [id],
      };

      const result = await client.query(query);

      return NextResponse.json(
        {
          success: true,
          message: 'successfully',
          data: result.rows[0],
        },
        { status: 200 },
      );
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          message: error.inner[0].message,
        },
        { status: 400 },
      );
    }
  } catch (e) {
    return NextResponse.json({
      success: false,
      message: 'Something goes wrong !Please try again',
    });
  }
}
