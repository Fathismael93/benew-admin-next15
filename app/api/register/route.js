// api/register.js
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getClient } from '@/utils/dbConnect';
import { quickValidationSchema } from '@/utils/schemas';

export async function POST(req) {
  let client;
  try {
    // Parse the request body
    const body = await req.json();
    const { username, email, password } = body;

    // Validate input using Yup schema
    try {
      await quickValidationSchema.validate(
        { username, email, password },
        { abortEarly: false },
      );
    } catch (validationError) {
      const errors = {};
      validationError.inner.forEach((error) => {
        errors[error.path] = error.message;
      });
      return NextResponse.json({ errors }, { status: 400 });
    }

    console.log('We are starting to check if user exits');

    client = await getClient();

    // Check if user already exists
    const userExistsQuery = 'SELECT user_id FROM users WHERE user_email = $1';
    const userExistsResult = await client.query(userExistsQuery, [email]);

    if (userExistsResult.rows.length > 0) {
      return NextResponse.json(
        { error: 'A user with this email or username already exists' },
        { status: 400 },
      );
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Insert new user
    const insertUserQuery = `
      INSERT INTO users (user_name, user_email, user_password)
      VALUES ($1, $2, $3)
      RETURNING user_id, user_name, user_email, user_added
    `;

    const result = await client.query(insertUserQuery, [
      username,
      email.toLowerCase(),
      hashedPassword,
    ]);

    // Return success response (excluding password)
    const newUser = result.rows[0];

    if (client) client.release();

    return NextResponse.json(
      {
        message: 'User registered successfully',
        user: {
          id: newUser.id,
          username: newUser.username,
          email: newUser.email,
          created_at: newUser.created_at,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (client) client.release();

    console.error('Registration error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
