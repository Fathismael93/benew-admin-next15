import { NextResponse } from 'next/server';
import pool from '@/utils/dbConnect';
import { addArticleSchema } from '@/utils/schemas';

const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute window
const MAX_REQUESTS = 5; // Max 5 requests per minute

// Rate limit store in-memory for this example (this could be more complex with Redis or DB)
let requestCounts = {};

export async function POST(req) {
  console.log('we are in the POST REQUEST of the blog api');
  try {
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

    console.log('');

    const formData = await req.json();
    const { title, text, imageUrl } = formData;

    console.log('gotten from req.body the data');
    console.log(title);
    console.log(text);
    console.log(imageUrl);

    // Trim inputs to prevent leading/trailing whitespace issues
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

    // Insert article into the database
    const query = {
      name: 'insert-article',
      text: 'INSERT INTO articles (article_title, article_text, article_image) VALUES ($1, $2, $3) RETURNING *',
      values: [cleanedData.title, cleanedData.text, cleanedData.imageUrl],
    };

    const { rows } = await pool.query(query);

    return NextResponse.json(
      {
        success: true,
        message: 'Article saved successfully',
        data: rows[0],
      },
      { status: 201 },
    );
  } catch (error) {
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
