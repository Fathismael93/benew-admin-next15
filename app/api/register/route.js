import bcrypt from 'bcryptjs';
import pool from '@/utils/dbConnect';
import { registrationSchema } from '@/utils/schemas'; // Import the same schema used in frontend
import { NextResponse } from 'next/server';

export async function POST(req) {
  try {
    console.log('We are register api');
    const body = await req.json();

    const { username, email, password } = body;

    // Validate input using Yup schema
    try {
      await registrationSchema.validate(
        { username, email, password },
        { abortEarly: false },
      );
    } catch (validationError) {
      const errors = {};
      validationError.inner.forEach((error) => {
        errors[error.path] = error.message;
      });
      return NextResponse.json(
        {
          success: false,
          errors,
        },
        { status: 400 },
      );
    }

    console.log('Checking if user with this email exists');

    // Check if user already exists
    const userExistsQuery = 'SELECT user_id FROM users WHERE user_email = $1';
    const userExistsResult = await pool.query(userExistsQuery, [email]);

    if (userExistsResult.rows.length > 0) {
      return NextResponse.json(
        {
          success: false,
          message: 'A user with this email already exists',
        },
        { status: 400 },
      );
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    console.log('Prepared Inserting Query');

    // Insert new user
    const insertUserQuery = `
      INSERT INTO users (user_name, user_email, user_password)
      VALUES ($1, $2, $3)
      RETURNING user_id, user_name, user_email, user_added
    `;

    const result = await pool.query(insertUserQuery, [
      username,
      email.toLowerCase(),
      hashedPassword,
    ]);

    // Return success response (excluding password)
    const newUser = result.rows[0];
    console.log('newUser: ');
    console.log(newUser);
    return NextResponse.json(
      {
        success: true,
        message: 'User registered successfully',
        user: {
          id: newUser.user_id,
          username: newUser.user_name,
          email: newUser.user_email,
          createdAt: newUser.user_added,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.error(
      {
        success: false,
        error: 'Internal server error',
      },
      { status: 500 },
    );
  }
}
