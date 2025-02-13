import { NextResponse } from 'next/server';
import pool from '@/utils/dbConnect';
import { addArticleSchema } from '@/utils/schemas';
import jwt from 'jsonwebtoken'; // If you're using JWT tokens
import { rateLimit } from '@/utils/rateLimit'; // Simple rate limiting utility

const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute window
const MAX_REQUESTS = 5; // Max 5 requests per minute

// Rate limit store in-memory for this example (this could be more complex with Redis or DB)
let requestCounts = {};

export async function POST(req) {
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

    // Authentication - assuming JWT token
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, message: 'Authorization token required.' },
        { status: 401 },
      );
    }

    const token = authHeader.split(' ')[1];
    try {
      // Validate the JWT token (replace with your actual secret)
      jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      return NextResponse.json(
        { success: false, message: 'Invalid or expired token.' },
        { status: 401 },
      );
    }

    const formData = await req.json();
    const { title, text, imageUrl } = formData;

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
