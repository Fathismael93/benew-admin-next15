import { NextResponse } from 'next/server';
import { articleIDSchema } from '@/utils/schemas';
import { getClient } from '@/utils/dbConnect';
import { sanitizeOutput } from '@/utils/sanitizers';

export const dynamic = 'force-dynamic';

const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute window
const MAX_REQUESTS = 5; // Max 5 requests per minute

// Rate limit store in-memory for this example (this could be more complex with Redis or DB)
let requestCounts = {};

export async function GET(req, { params }) {
  try {
    // 1. Apply rate limiting
    // Handle rate limiting
    const ip = req.headers.get('x-forwarded-for') || req.socket.remoteAddress;

    if (!ip) {
      return NextResponse.json(
        { success: false, message: 'Unable to determine IP address.' },
        { status: 400 },
      );
    }

    const currentTime = Date.now();
    if (!requestCounts[ip]) {
      requestCounts[ip] = { count: 1, firstRequestTime: currentTime };
    } else {
      const elapsedTime = currentTime - requestCounts[ip].firstRequestTime;
      if (
        elapsedTime < RATE_LIMIT_WINDOW &&
        requestCounts[ip].count >= MAX_REQUESTS
      ) {
        return NextResponse.json(
          { success: false, message: 'Rate limit exceeded. Try again later.' },
          { status: 429 },
        );
      }
      if (elapsedTime >= RATE_LIMIT_WINDOW) {
        requestCounts[ip] = { count: 1, firstRequestTime: currentTime }; // Reset count
      } else {
        requestCounts[ip].count++;
      }
    }

    // 2. Validate the article ID
    const { id } = await params;

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
        // const sanitizedData = sanitizeOutput
        //   ? sanitizeOutput(rows[0])
        //   : rows[0];

        // 4. Sanitize the output
        const sanitizedData = rows[0];

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
