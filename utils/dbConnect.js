// import { Pool } from 'pg';

// const pool = new Pool({
//   user: process.env.USER_NAME,
//   host: process.env.HOST_NAME,
//   database: process.env.DB_NAME,
//   password: process.env.DB_PASSWORD,
//   port: process.env.PORT_NUMBER,
//   connectionTimeoutMillis: process.env.CONNECTION_TIMEOUT,
//   ssl: {
//     require: true,
//     rejectUnauthorized: false,
//     ca: `-----BEGIN CERTIFICATE-----
// MIIETTCCArWgAwIBAgIUBYEsLHwAilO5DpIRjUaBmvDvJnQwDQYJKoZIhvcNAQEM
// BQAwQDE+MDwGA1UEAww1ZTdiYjRlZTItMDBiOS00MjUxLWI0MzktYTgzMDViZTA3
// YTZhIEdFTiAxIFByb2plY3QgQ0EwHhcNMjUwMjAzMDg0NzA1WhcNMzUwMjAxMDg0
// NzA1WjBAMT4wPAYDVQQDDDVlN2JiNGVlMi0wMGI5LTQyNTEtYjQzOS1hODMwNWJl
// MDdhNmEgR0VOIDEgUHJvamVjdCBDQTCCAaIwDQYJKoZIhvcNAQEBBQADggGPADCC
// AYoCggGBAJSxPwBCJprg7ubeLlyAIgN0eyV05AH9/qGsYkdHpFLEw9zD9TU3SksL
// R3broG8dIgFb8OJ/itosqurinH2DCquCUmZlTRolKM9ub9FHgbUdbYLaxkRXxblE
// nYQxe7omjihZ6MOWjjDbG4p07pc+5XNQlVC5MzvGN+NSAgyRb8WKgNmOvy0YJZvY
// kvMpPj4x5eU6FWDSPtXiNfVyPmMpq0InNzXTN4k6LvUrcQP3GnoUGc4VOcT197C2
// QcRaeJxgxoH2lxPdOoPGEDnikqHU7oIpBzABUGIPe3YfqPWKRVbKNxMCezUbvLgf
// LfZJ50fdHhhpku9CY2DRaj9AwcWv+6mO/DHovZuqbdbm+PLv6N7He4TL0k8uc9lh
// qbHZuvCm/eT9ei6RaAWKuIV3UlVbknDiO1R6JOiQM/gJy2f0U5yEWXefC6K0hJZ2
// z4H63ankFBMovtzURF8cMS164DnbslPxCEKNuPCLA+fzX8Q99ZD+MjoX/Vy2ZeGE
// afNCC3ONqwIDAQABoz8wPTAdBgNVHQ4EFgQUmNxI/MNI7f0bbE9VvFGyq0HC4rcw
// DwYDVR0TBAgwBgEB/wIBADALBgNVHQ8EBAMCAQYwDQYJKoZIhvcNAQEMBQADggGB
// ADvYycj1+qxH8yh/v5B1IUHhaWe7po/8iX26H9WNUl+vlM9w79V9e1EQbkglWzk7
// AhWyGKQBkB3LQlXHxW6T/ECJq/MjPcWI0AoDd1Wls2+lnDZaU3OJH20IBlC3dzii
// yj1oZe/Ukgh6Y5Z3FTZgVAMZIoyRI4uIeoDh0cRr/3wUGc/M57fP2tbbqV+3bQgJ
// 0GqBxrT0ODobirtJn6CmZdMIDShMaARdEmpg0tFT6HUION68Hc9uLJLa+iuGybkX
// ltUnPBMYYX5YtgOsAUZtoV36y274z8+Of+CfpyS4TWyTgkz1XapFwOrRibOeWkOB
// fyYB0hv/ZBRO1U5Wvz+z/fargp23byzu4CsI4sKiQw4CzMMjy5W//JfN+xzySnra
// ca/gk5UYVeHXPU+iFic591IVhhkn69gTOeGFJfKND36f2fW01OxIvU9Dz/q0dG8d
// Eku5JGX9oM1/9QdL/trWNYKDxTL+Acb+7/zN2waXPdkLngpsamJR69TvyBqvBZcT
// vw==
// -----END CERTIFICATE-----`,
//   },
//   max: process.env.MAXIMUM_CLIENTS, // Maximum number of clients in the pool
//   idleTimeoutMillis: process.env.CLIENT_EXISTENCE, // How long a client is allowed to remain idle before being closed
// });

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
  if (process.env.DB_CA) {
    console.log(process.env.DB_CA);
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
      err.message,
    );
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
