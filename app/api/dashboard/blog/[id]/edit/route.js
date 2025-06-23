import { NextResponse } from 'next/server';
import { getClient } from '@backend/dbConnect';
import { addArticleSchema } from '@utils/schemas/articleSchema';

const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute window
const MAX_REQUESTS = 5; // Max 5 requests per minute

let requestCounts = {};

export async function PUT(req, { params }) {
  let client;
  try {
    const { id } = await params;

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
        requestCounts[ip] = { count: 1, firstRequestTime: currentTime };
      } else {
        requestCounts[ip].count++;
      }
    }

    const formData = await req.json();
    const { title, text, imageUrl } = formData;

    // Trim inputs
    const cleanedData = {
      title: title?.trim(),
      text: text?.trim(),
      imageUrl: imageUrl?.trim(),
    };

    // Validate input
    try {
      await addArticleSchema.validate(cleanedData, { abortEarly: false });
    } catch (validationError) {
      return NextResponse.json(
        {
          success: false,
          message: 'Validation failed',
          errors: validationError.inner.map((err) => err.message),
        },
        { status: 422 },
      );
    }

    client = await getClient();

    const query = {
      name: 'update-article',
      text: `
        UPDATE articles 
        SET article_title = $1, article_text = $2, article_image = $3 
        WHERE article_id = $4 
        RETURNING *
      `,
      values: [cleanedData.title, cleanedData.text, cleanedData.imageUrl, id],
    };

    const { rows } = await client.query(query);

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, message: 'Article not found' },
        { status: 404 },
      );
    }

    if (client) await client.cleanup();

    return NextResponse.json(
      {
        success: true,
        message: 'Article updated successfully',
        data: rows[0],
      },
      { status: 200 },
    );
  } catch (error) {
    if (client) await client.cleanup();
    console.error('Server Error:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'Internal server error',
      },
      { status: 500 },
    );
  }
}
