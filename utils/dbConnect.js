import { Pool } from 'pg';

const MAX_RETRIES = 5; // Max reconnection attempts
const RETRY_DELAY = 5000; // Delay between retries (in ms)

// Helper function to get formatted timestamp
const getTimestamp = () => new Date().toISOString();

// List of required environment variables
const requiredEnvVars = [
  'USER_NAME',
  'HOST_NAME',
  'DB_NAME',
  'DB_PASSWORD',
  'PORT_NUMBER',
  'CONNECTION_TIMEOUT',
  'MAXIMUM_CLIENTS',
  'CLIENT_EXISTENCE',
  'DB_CA',
];

// Warn if any environment variables are missing
requiredEnvVars.forEach((envVar) => {
  if (!process.env[envVar]) {
    console.warn(
      `[${getTimestamp()}] ⚠️ Warning: Missing environment variable: ${envVar}`,
    );
  }
});

let pool;

// 🔄 Function to create a new pool (for reconnection)
const createPool = () => {
  pool = new Pool({
    user: process.env.USER_NAME,
    host: process.env.HOST_NAME,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.PORT_NUMBER) || 5432,
    connectionTimeoutMillis: Number(process.env.CONNECTION_TIMEOUT) || 5000,
    max: Number(process.env.MAXIMUM_CLIENTS) || 10,
    idleTimeoutMillis: Number(process.env.CLIENT_EXISTENCE) || 30000,

    ssl: process.env.DB_CA
      ? {
          require: true,
          rejectUnauthorized: true,
          ca: process.env.DB_CA,
        }
      : false,
  });

  pool.on('error', async (err) => {
    console.error(
      `[${getTimestamp()}] ❌ Unexpected database error:`,
      err.message,
    );
    await reconnectPool();
  });

  return pool;
};

pool = createPool();

// 🔄 Reconnection logic
const reconnectPool = async (attempt = 1) => {
  console.log(
    `[${getTimestamp()}] 🔄 Attempting to reconnect... (Attempt ${attempt}/${MAX_RETRIES})`,
  );

  try {
    await pool.end(); // Close existing pool
  } catch (err) {
    console.error(
      `[${getTimestamp()}] ⚠️ Error closing existing pool:`,
      err.message,
    );
  }

  try {
    pool = createPool();
    const client = await pool.connect();
    console.log(
      `[${getTimestamp()}] ✅ Reconnected to the database successfully`,
    );
    client.release();
  } catch (err) {
    console.error(
      `[${getTimestamp()}] ❌ Reconnection attempt ${attempt} failed:`,
      err.message,
    );
    if (attempt < MAX_RETRIES) {
      setTimeout(() => reconnectPool(attempt + 1), RETRY_DELAY);
    } else {
      console.error(
        `[${getTimestamp()}] 🚨 Maximum reconnection attempts reached. Database is unavailable.`,
      );
    }
  }
};

// 🔹 Function to get a database client safely
export const getClient = async () => {
  try {
    const client = await pool.connect();
    console.log(`[${getTimestamp()}] ✅ Database client acquired`);
    return client;
  } catch (err) {
    console.error(
      `[${getTimestamp()}] ❌ Error acquiring database client:`,
      err.message,
    );
    throw new Error('Database connection error');
  }
};

// 🔹 Test database connection on startup
(async () => {
  try {
    const client = await pool.connect();
    console.log(`[${getTimestamp()}] ✅ Database connected successfully`);
    client.release();
  } catch (err) {
    console.error(
      `[${getTimestamp()}] ❌ Initial database connection failed. Attempting to reconnect...`,
    );
    console.error(err);
    reconnectPool();
  }
})();

// 🔹 Graceful shutdown (to close pool when app stops)
const shutdown = async () => {
  try {
    await pool.end();
    console.log(`[${getTimestamp()}] ✅ Database pool closed`);
  } catch (err) {
    console.error(
      `[${getTimestamp()}] ❌ Error closing database pool:`,
      err.message,
    );
  }
};

// Handle process exit signals
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export default pool;
