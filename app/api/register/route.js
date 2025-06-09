// api/register.js
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getClient } from '@/utils/dbConnect';
import { registrationSchema } from '@/utils/schemas';

export async function POST(req) {
  let client;
  try {
    // Parse the request body
    const body = await req.json();
    const { username, email, phone, password, dateOfBirth } = body;

    console.log('username:', username);
    console.log('email:', email);
    console.log('phone:', phone);
    console.log('password:', password);
    console.log('dateOfBirth:', dateOfBirth);

    // Validate input using Yup schema
    try {
      await registrationSchema.validate(
        { username, email, phone, password, dateOfBirth },
        { abortEarly: false },
      );
    } catch (validationError) {
      const errors = {};
      validationError.inner.forEach((error) => {
        errors[error.path] = error.message;
      });
      return NextResponse.json({ errors }, { status: 400 });
    }

    client = await getClient();

    // Check if user already exists
    const userExistsQuery =
      'SELECT user_id FROM admin.users WHERE user_email = $1';
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
      INSERT INTO admin.users (user_name, user_email, user_password, user_phone, user_birthdate)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING user_id, user_name, user_email, user_phone, user_birthdate, user_image, user_added, user_updated
    `;

    const result = await client.query(insertUserQuery, [
      username,
      email.toLowerCase(),
      hashedPassword,
      phone || null, // Allow phone to be optional
      dateOfBirth || null, // Allow dateOfBirth to be optional
    ]);

    // Return success response (excluding password)
    const newUser = result.rows[0];

    console.log('New user created:', newUser);

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
