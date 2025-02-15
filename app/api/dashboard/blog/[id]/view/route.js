import { NextResponse } from 'next/server';
import { articleIDSchema } from '@/utils/schemas';
import { getClient } from '@/utils/dbConnect';
import { rateLimiter } from '@/utils/rateLimiter';
import { sanitizeOutput } from '@/utils/sanitizers';

export const dynamic = 'force-dynamic';

export async function GET(req, { params }) {
  try {
    // 1. Apply rate limiting
    try {
      const limited = await rateLimiter.check(req);

      if (limited) {
        return NextResponse.json(
          {
            success: false,
            message: 'Too many requests, please try again later',
          },
          {
            status: 429,
            headers: {
              'Retry-After': '60',
            },
          },
        );
      }
    } catch (error) {
      // Continue execution even if rate limiting fails
      console.error('Rate limiting error:', error);
    }

    // 2. Validate the article ID
    console.log('params');
    console.log(await params);
    const { id } = await params;
    console.log(id);

    try {
      await articleIDSchema.validate({ id });
    } catch (error) {
      console.warn('Invalid article ID format', { id, error: error.message });
      return NextResponse.json(
        {
          success: false,
          message: error.message,
        },
        { status: 400 },
      );
    }

    // 3. Query the database with proper error handling
    try {
      const client = await getClient();

      try {
        const query = {
          name: 'get-single-article',
          text: `
            SELECT 
              article_id, 
              article_title, 
              article_text, 
              article_image, 
              TO_CHAR(article_created, 'dd/MM/yyyy') as created 
            FROM articles 
            WHERE article_id = $1
          `,
          values: [id],
        };

        const { rows } = await client.query(query);
        console.log('rows: ');
        console.log(rows);

        if (rows.length === 0) {
          console.info('Article not found', { id });
          return NextResponse.json(
            {
              success: false,
              message: 'Article not found',
            },
            { status: 404 },
          );
        }

        // 4. Sanitize the output
        const sanitizedData = sanitizeOutput
          ? sanitizeOutput(rows[0])
          : rows[0];

        // 5. Return successful response with proper caching headers
        return NextResponse.json(
          {
            success: true,
            message: 'Article retrieved successfully',
            data: sanitizedData,
          },
          {
            status: 200,
            headers: {
              'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
            },
          },
        );
      } finally {
        // Always release the client back to the pool
        client.release();
      }
    } catch (dbError) {
      console.error('Database query error', {
        error: dbError.message,
        stack: dbError.stack,
      });
      return NextResponse.json(
        {
          success: false,
          message: 'Database error occurred',
        },
        { status: 500 },
      );
    }
  } catch (error) {
    // Catch all unexpected errors
    console.error('Unexpected error in article retrieval', {
      error: error.message,
      stack: error.stack,
      params,
    });

    return NextResponse.json(
      {
        success: false,
        message: 'An unexpected error occurred. Please try again later.',
      },
      { status: 500 },
    );
  }
}
