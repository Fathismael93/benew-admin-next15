import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { getClient } from '@backend/dbConnect';

const authOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        let client;
        try {
          // Find user in the database
          client = await getClient();

          const query =
            'SELECT user_id, user_name, user_email, user_phone, user_birthdate, user_image, user_password FROM admin.users WHERE user_email = $1';

          const result = await client.query(query, [
            credentials.email.toLowerCase(),
          ]);

          if (result.rows.length === 0) {
            // No user found with this email
            if (client) await client.cleanup();
            return null;
          }

          const user = result.rows[0];

          // Verify password
          const isPasswordValid = await bcrypt.compare(
            credentials.password,
            user.user_password,
          );

          if (!isPasswordValid) {
            // Invalid password
            if (client) await client.cleanup();
            return null;
          }

          // Return user object (excluding password)
          if (client) await client.cleanup();

          return {
            id: user.user_id,
            name: user.user_name,
            email: user.user_email,
          };
        } catch (error) {
          if (client) await client.cleanup();
          console.error('Auth error:', error);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    jwt: async ({ token, user }) => {
      // Initial sign in
      if (user) {
        token.id = user.id;
        token.name = user.name;
        token.email = user.email;
      }
      return token;
    },
    session: async ({ session, token }) => {
      if (token) {
        session.user.id = token.id;
        session.user.name = token.name;
        session.user.email = token.email;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST, authOptions as auth };
