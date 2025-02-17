import bcrypt from 'bcryptjs';
import pool from '@/utils/dbConnect';
import { registrationSchema } from '@/utils/schemas'; // Import the same schema used in frontend

export async function POST(req, res) {
  try {
    console.log('We are register api');
    const body = await req.json();

    const { username, email, password } = body;
    console.log('username: ');
    console.log(username);
    console.log('email: ');
    console.log(email);
    console.log('password: ');
    console.log(password);

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
      return res.status(400).json({ errors });
    }

    // Check if user already exists
    const userExistsQuery = 'SELECT user_id FROM users WHERE user_email = $1';
    const userExistsResult = await pool.query(userExistsQuery, [email]);

    if (userExistsResult.rows.length > 0) {
      return res.status(400).json({
        error: 'A user with this email already exists',
      });
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

    const result = await pool.query(insertUserQuery, [
      username,
      email.toLowerCase(),
      hashedPassword,
    ]);

    // Return success response (excluding password)
    const newUser = result.rows[0];
    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: newUser.user_id,
        username: newUser.user_name,
        email: newUser.user_email,
        createdAt: newUser.user_added,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
