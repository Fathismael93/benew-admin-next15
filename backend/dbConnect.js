import { Client } from 'pg';

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

// Configuration object for creating clients
const getClientConfig = () => ({
  user: process.env.USER_NAME,
  host: process.env.HOST_NAME,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.PORT_NUMBER) || 5432,
  connectionTimeoutMillis: Number(process.env.CONNECTION_TIMEOUT) || 5000,
  ssl: process.env.DB_CA
    ? {
        require: true,
        rejectUnauthorized: true,
        ca: process.env.DB_CA,
      }
    : false,
});

// 🔹 Function to get a database client
export const getClient = async () => {
  try {
    const client = new Client(getClientConfig());
    await client.connect();
    console.log(`[${getTimestamp()}] ✅ Database client connected`);

    // Add a cleanup method to the client
    client.cleanup = async () => {
      try {
        await client.end();
        console.log(`[${getTimestamp()}] ✅ Database client disconnected`);
      } catch (err) {
        console.error(
          `[${getTimestamp()}] ❌ Error disconnecting client:`,
          err.message,
        );
      }
    };

    return client;
  } catch (err) {
    console.error(
      `[${getTimestamp()}] ❌ Error connecting database client:`,
      err.message,
    );
    return retryConnection();
  }
};

// 🔄 Retry connection logic
const retryConnection = async (attempt = 1) => {
  if (attempt > MAX_RETRIES) {
    console.error(
      `[${getTimestamp()}] 🚨 Maximum connection attempts reached. Database is unavailable.`,
    );
    throw new Error('Database connection error after maximum retry attempts');
  }

  console.log(
    `[${getTimestamp()}] 🔄 Attempting to connect... (Attempt ${attempt}/${MAX_RETRIES})`,
  );

  return new Promise((resolve, reject) => {
    setTimeout(async () => {
      try {
        const client = new Client(getClientConfig());
        await client.connect();
        console.log(
          `[${getTimestamp()}] ✅ Database connected successfully on retry ${attempt}`,
        );

        // Add cleanup method
        client.cleanup = async () => {
          try {
            await client.end();
            console.log(`[${getTimestamp()}] ✅ Database client disconnected`);
          } catch (err) {
            console.error(
              `[${getTimestamp()}] ❌ Error disconnecting client:`,
              err.message,
            );
          }
        };

        resolve(client);
      } catch (err) {
        console.error(
          `[${getTimestamp()}] ❌ Connection attempt ${attempt} failed:`,
          err.message,
        );
        try {
          resolve(await retryConnection(attempt + 1));
        } catch (retryErr) {
          reject(retryErr);
        }
      }
    }, RETRY_DELAY);
  });
};

// 🔹 Test database connection on startup
(async () => {
  try {
    const testClient = await getClient();
    console.log(
      `[${getTimestamp()}] ✅ Initial database connection test successful`,
    );
    await testClient.cleanup();
  } catch (err) {
    console.error(
      `[${getTimestamp()}] ❌ Initial database connection test failed:`,
      err.message,
    );
  }
})();

// Handle process exit signals - no pool to clean up, but log the exit
process.on('SIGINT', () => {
  console.log(`[${getTimestamp()}] 🛑 Received SIGINT signal, exiting...`);
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log(`[${getTimestamp()}] 🛑 Received SIGTERM signal, exiting...`);
  process.exit(0);
});
