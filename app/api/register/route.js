import bcrypt from 'bcryptjs';
import pool from '@/utils/dbConnect';
import { registrationSchema } from '@/utils/schemas'; // Import the same schema used in frontend

export async function POST(req, res) {
  try {
    console.log('We are register api');
    const { username, email, password } = req.body;

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
    const userExistsQuery =
      'SELECT user_id FROM users WHERE user_email = $1 OR user_name = $2';
    const userExistsResult = await pool.query(userExistsQuery, [
      email,
      username,
    ]);

    if (userExistsResult.rows.length > 0) {
      return res.status(400).json({
        error: 'A user with this email or username already exists',
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Insert new user
    const insertUserQuery = `
      INSERT INTO users (user_name, user_email, user_password, user_added)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
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
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        created_at: newUser.created_at,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
