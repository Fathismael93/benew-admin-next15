import { NextResponse } from 'next/server';
import client from '@/utils/dbConnect';
import { articleIDSchema } from '@/utils/schemas';

export const dynamic = 'force-dynamic';

export async function GET({ params }) {
  try {
    const { id } = params;

    try {
      await articleIDSchema.validate({ id });

      const query = {
        // give the query a unique name
        name: 'get-single-article',
        text: "SELECT article_id, article_title, article_text, article_image, TO_CHAR(article_created,'dd/MM/yyyy') as created FROM articles WHERE article_id=$1",
        values: [id],
      };

      client.connect(function (err) {
        if (err) {
          console.log(err);
          throw err;
        }

        console.log('Connected To Aiven, Postgresql Database');
      });

      const result = await client.query(query);

      client.end(function (err) {
        if (err) {
          console.log(err);
          throw err;
        }

        console.log('Client Connected To Aiven Postgresql Database is stopped');
      });

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
