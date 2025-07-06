/* eslint-disable no-unused-vars */
import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { getClient } from '@backend/dbConnect';

// Imports pour la sécurité et le monitoring
import { loginSchema } from '@utils/schemas/authSchema';
import {
  sanitizeLoginInputsStrict,
  detectSuspiciousLoginActivity,
} from '@utils/sanitizers/sanitizeLoginInputs';
import { captureAuthError, captureMessage } from '@monitoring/sentry';
import logger from '@utils/logger';
import { memoizeWithTTL } from '@utils/performance';
import { applyRateLimit, captureRateLimitError } from '@backend/rateLimiter';

// Memoize de la recherche d'utilisateur pour optimiser les performances
const findUserByEmail = memoizeWithTTL(
  async (email) => {
    let client;
    try {
      console.log('Searching for user with email:', email);
      client = await getClient();
      console.log('client:', client);
      const query =
        'SELECT user_id, user_name, user_email, user_phone, user_birthdate, user_image, user_password FROM admin.users WHERE user_email = $1';
      const result = await client.query(query, [email]);

      logger.info('User search executed', {
        email: email.substring(0, 3) + '***', // Email partiellement masqué
        found: result.rows.length > 0,
        query_duration: Date.now(),
      });

      return result.rows;
    } catch (error) {
      logger.error('Database error during user search', {
        error: error.message,
        email: email.substring(0, 3) + '***',
      });
      throw error;
    } finally {
      if (client) await client.cleanup();
    }
  },
  300000, // Cache pendant 5 minutes
);

const authOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, req) {
        console.log('credentials:', credentials);
        const startTime = Date.now();
        const clientIP =
          req?.headers?.['x-forwarded-for'] ||
          req?.headers?.['x-real-ip'] ||
          req?.connection?.remoteAddress ||
          'unknown';

        logger.info('Login attempt initiated', {
          ip: clientIP,
          userAgent: req?.headers?.['user-agent'],
          timestamp: new Date().toISOString(),
        });

        try {
          console.log('Received credentials:', credentials);
          // 1. Validation de base des credentials
          if (!credentials?.email || !credentials?.password) {
            logger.warn('Login attempt with missing credentials', {
              ip: clientIP,
              hasEmail: !!credentials?.email,
              hasPassword: !!credentials?.password,
            });
            return null;
          }

          // 2. Sanitization des inputs
          const sanitizedCredentials = sanitizeLoginInputsStrict({
            email: credentials.email,
            password: credentials.password,
          });

          console.log('Sanitized credentials:', sanitizedCredentials);

          logger.debug('Credentials sanitized', {
            ip: clientIP,
            email: sanitizedCredentials.email.substring(0, 3) + '***',
          });

          // 3. Validation avec Yup schema
          try {
            await loginSchema.validate(sanitizedCredentials, {
              abortEarly: false,
            });
          } catch (validationError) {
            logger.warn('Login validation failed', {
              ip: clientIP,
              email: sanitizedCredentials.email.substring(0, 3) + '***',
              errors: validationError.errors,
              validationType: 'yup_schema',
            });

            captureAuthError(validationError, {
              method: 'login_validation',
              provider: 'credentials',
              tags: {
                validation_failed: true,
                ip: clientIP.substring(0, 8) + '***',
              },
              extra: {
                validationErrors: validationError.errors,
                email: sanitizedCredentials.email.substring(0, 3) + '***',
              },
            });

            return null;
          }

          // Fonction pour vérifier le rate limiting
          const checkAuthRateLimit = async (req) => {
            try {
              const rateLimitResponse = await rateLimitMiddleware(req);

              if (rateLimitResponse !== null) {
                console.log('Rate limit response:', rateLimitResponse);
                // Rate limit dépassé
                const rateLimitData = await rateLimitResponse.json();

                logger.warn('Authentication rate limit exceeded', {
                  ip: req.headers?.['x-forwarded-for'] || 'unknown',
                  retryAfter: rateLimitData.retryAfter,
                  reference: rateLimitData.reference,
                  component: 'auth_rate_limit',
                });

                return {
                  isBlocked: true,
                  response: rateLimitResponse,
                  retryAfter: rateLimitData.retryAfter,
                  reference: rateLimitData.reference,
                };
              }

              return { isBlocked: false };
            } catch (error) {
              logger.error('Error checking auth rate limit', {
                error: error.message,
                component: 'auth_rate_limit',
              });

              captureRateLimitError(error, {
                preset: 'AUTH_ENDPOINTS',
                endpoint: '/api/auth/callback/credentials',
                action: 'rate_limit_check',
              });

              // En cas d'erreur, laisser passer (fail open)
              return { isBlocked: false };
            }
          };

          // 4. Rate limiting avec votre système avancé
          const rateLimitCheck = await checkAuthRateLimit({
            headers: req?.headers || {},
            body: { email: sanitizedCredentials.email },
            // connection: req?.connection || {},
            url: '/api/auth/callback/credentials',
          });

          if (rateLimitCheck.isBlocked) {
            logger.warn('Authentication rate limit exceeded', {
              ip: clientIP,
              email: sanitizedCredentials.email.substring(0, 3) + '***',
              retryAfter: rateLimitCheck.retryAfter,
              reference: rateLimitCheck.reference,
              rateLimitType: 'auth_endpoints',
            });

            captureMessage('Authentication rate limit exceeded', {
              level: 'warning',
              tags: {
                rate_limit: true,
                auth_rate_limit: true,
                ip: clientIP.substring(0, 8) + '***',
              },
              extra: {
                retryAfter: rateLimitCheck.retryAfter,
                reference: rateLimitCheck.reference,
                email: sanitizedCredentials.email.substring(0, 3) + '***',
              },
            });

            return null;
          }

          // Rate limiting avec votre système avancé
          const rateLimitMiddleware = applyRateLimit('AUTH_ENDPOINTS', {
            keyGenerator: (req) => {
              // Générer une clé basée sur IP + email pour les tentatives de login
              const ip =
                req.headers?.['x-forwarded-for'] ||
                req.headers?.['x-real-ip'] ||
                req.connection?.remoteAddress ||
                'unknown';

              try {
                // Tenter d'extraire l'email si disponible dans le body
                if (
                  req.body &&
                  typeof req.body === 'object' &&
                  req.body.email
                ) {
                  const emailHash = Buffer.from(req.body.email)
                    .toString('base64')
                    .substring(0, 8);
                  return `auth:email:${emailHash}:ip:${ip}`;
                }
              } catch (e) {
                // Fallback sur IP seulement
              }

              return `auth:ip:${ip}`;
            },
          });

          // 5. Détection d'activité suspecte
          const isSuspicious = detectSuspiciousLoginActivity(
            sanitizedCredentials.email,
          );
          if (isSuspicious) {
            logger.warn('Suspicious login activity detected', {
              ip: clientIP,
              email: sanitizedCredentials.email.substring(0, 3) + '***',
              suspiciousActivity: true,
            });

            captureMessage('Suspicious login activity detected', {
              level: 'warning',
              tags: {
                suspicious_activity: true,
                ip: clientIP.substring(0, 8) + '***',
              },
              extra: {
                email: sanitizedCredentials.email.substring(0, 3) + '***',
              },
            });

            // Ne pas bloquer complètement, mais logger pour investigation
          }

          // 6. Recherche de l'utilisateur dans la base de données
          let userRows;
          try {
            userRows = await findUserByEmail(
              sanitizedCredentials.email.toLowerCase(),
            );
          } catch (dbError) {
            logger.error('Database error during user lookup', {
              ip: clientIP,
              email: sanitizedCredentials.email.substring(0, 3) + '***',
              error: dbError.message,
              errorType: 'database_connection',
            });

            captureAuthError(dbError, {
              method: 'user_lookup',
              provider: 'credentials',
              tags: {
                database_error: true,
                ip: clientIP.substring(0, 8) + '***',
              },
              extra: {
                email: sanitizedCredentials.email.substring(0, 3) + '***',
                postgresCode: dbError.code,
              },
            });

            return null;
          }

          // 7. Vérification de l'existence de l'utilisateur
          if (userRows.length === 0) {
            const duration = Date.now() - startTime;

            logger.warn('Login attempt for non-existent user', {
              ip: clientIP,
              email: sanitizedCredentials.email.substring(0, 3) + '***',
              duration,
              result: 'user_not_found',
            });

            captureAuthError(new Error('User not found'), {
              method: 'user_authentication',
              provider: 'credentials',
              tags: {
                user_not_found: true,
                ip: clientIP.substring(0, 8) + '***',
              },
              extra: {
                email: sanitizedCredentials.email.substring(0, 3) + '***',
                attemptDuration: duration,
              },
            });

            return null;
          }

          console.log('User found:', userRows);

          const user = userRows[0];

          console.log('User details:', user);

          // 8. Vérification du mot de passe
          let isPasswordValid;
          try {
            isPasswordValid = await bcrypt.compare(
              sanitizedCredentials.password,
              user.user_password,
            );
          } catch (bcryptError) {
            logger.error('Password verification error', {
              ip: clientIP,
              email: sanitizedCredentials.email.substring(0, 3) + '***',
              error: bcryptError.message,
              errorType: 'bcrypt_comparison',
            });

            captureAuthError(bcryptError, {
              method: 'password_verification',
              provider: 'credentials',
              tags: {
                bcrypt_error: true,
                ip: clientIP.substring(0, 8) + '***',
              },
            });

            return null;
          }

          // 9. Résultat de l'authentification
          const duration = Date.now() - startTime;

          if (!isPasswordValid) {
            logger.warn('Login attempt with invalid password', {
              ip: clientIP,
              email: sanitizedCredentials.email.substring(0, 3) + '***',
              userId: user.user_id,
              duration,
              result: 'invalid_password',
              attemptsRemaining: rateLimitCheck.attemptsRemaining - 1,
            });

            captureAuthError(new Error('Invalid password'), {
              method: 'password_authentication',
              provider: 'credentials',
              tags: {
                invalid_password: true,
                ip: clientIP.substring(0, 8) + '***',
              },
              extra: {
                userId: user.user_id,
                email: sanitizedCredentials.email.substring(0, 3) + '***',
                attemptDuration: duration,
              },
            });

            return null;
          }

          // 10. Authentification réussie
          logger.info('Successful login', {
            ip: clientIP,
            userId: user.user_id,
            email: sanitizedCredentials.email.substring(0, 3) + '***',
            duration,
            result: 'success',
          });

          captureMessage('Successful user authentication', {
            level: 'info',
            tags: {
              authentication_success: true,
              ip: clientIP.substring(0, 8) + '***',
            },
            extra: {
              userId: user.user_id,
              email: sanitizedCredentials.email.substring(0, 3) + '***',
              authenticationDuration: duration,
            },
          });

          // Retourner l'objet utilisateur (sans le mot de passe)
          return {
            id: user.user_id,
            name: user.user_name,
            email: user.user_email,
          };
        } catch (error) {
          const duration = Date.now() - startTime;

          logger.error('Unexpected error during authentication', {
            ip: clientIP,
            error: error.message,
            stack: error.stack,
            duration,
            errorType: 'unexpected_auth_error',
          });

          captureAuthError(error, {
            method: 'authentication_process',
            provider: 'credentials',
            tags: {
              unexpected_error: true,
              ip: clientIP.substring(0, 8) + '***',
            },
            extra: {
              authenticationDuration: duration,
              errorStack: error.stack,
            },
          });

          return null;
        }
      },
    }),
  ],
  callbacks: {
    jwt: async ({ token, user }) => {
      try {
        // Initial sign in
        if (user) {
          token.id = user.id;
          token.name = user.name;
          token.email = user.email;

          logger.debug('JWT token created', {
            userId: user.id,
            email: user.email.substring(0, 3) + '***',
            tokenGenerated: true,
          });
        }
        return token;
      } catch (error) {
        logger.error('JWT callback error', {
          error: error.message,
          userId: user?.id,
          tokenGeneration: false,
        });

        captureAuthError(error, {
          method: 'jwt_callback',
          provider: 'nextauth',
          tags: {
            jwt_error: true,
          },
          extra: {
            userId: user?.id,
          },
        });

        return token;
      }
    },
    session: async ({ session, token }) => {
      try {
        if (token) {
          session.user.id = token.id;
          session.user.name = token.name;
          session.user.email = token.email;

          logger.debug('Session created', {
            userId: token.id,
            email: token.email?.substring(0, 3) + '***',
            sessionGenerated: true,
          });
        }
        return session;
      } catch (error) {
        logger.error('Session callback error', {
          error: error.message,
          userId: token?.id,
          sessionGeneration: false,
        });

        captureAuthError(error, {
          method: 'session_callback',
          provider: 'nextauth',
          tags: {
            session_error: true,
          },
          extra: {
            userId: token?.id,
          },
        });

        return session;
      }
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
  events: {
    async signIn(message) {
      logger.info('NextAuth signIn event', {
        userId: message.user?.id,
        email: message.user?.email?.substring(0, 3) + '***',
        provider: message.account?.provider,
        eventType: 'signIn',
      });
    },
    async signOut(message) {
      logger.info('NextAuth signOut event', {
        userId: message.token?.id,
        email: message.token?.email?.substring(0, 3) + '***',
        eventType: 'signOut',
      });
    },
    async createUser(message) {
      logger.info('NextAuth createUser event', {
        userId: message.user?.id,
        email: message.user?.email?.substring(0, 3) + '***',
        eventType: 'createUser',
      });
    },
    async session(message) {
      logger.debug('NextAuth session event', {
        userId: message.session?.user?.id,
        eventType: 'session_access',
      });
    },
  },
  logger: {
    error(code, metadata) {
      logger.error('NextAuth internal error', {
        errorCode: code,
        metadata: metadata,
        source: 'nextauth_internal',
      });

      captureAuthError(new Error(`NextAuth error: ${code}`), {
        method: 'nextauth_internal',
        provider: 'nextauth',
        tags: {
          nextauth_internal_error: true,
          errorCode: code,
        },
        extra: {
          metadata: metadata,
        },
      });
    },
    warn(code) {
      logger.warn('NextAuth warning', {
        warningCode: code,
        source: 'nextauth_internal',
      });
    },
    debug(code, metadata) {
      if (process.env.NODE_ENV === 'development') {
        logger.debug('NextAuth debug', {
          debugCode: code,
          metadata: metadata,
          source: 'nextauth_internal',
        });
      }
    },
  },
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST, authOptions as auth };
