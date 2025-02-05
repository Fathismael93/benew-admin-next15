import { Client } from 'pg';

const client = new Client({
  user: process.env.USER_NAME,
  host: process.env.HOST_NAME,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.PORT_NUMBER,
  ssl: {
    require: true,
    rejectUnauthorized: false,
    ca: `-----BEGIN CERTIFICATE-----
MIIETTCCArWgAwIBAgIUBYEsLHwAilO5DpIRjUaBmvDvJnQwDQYJKoZIhvcNAQEM
BQAwQDE+MDwGA1UEAww1ZTdiYjRlZTItMDBiOS00MjUxLWI0MzktYTgzMDViZTA3
YTZhIEdFTiAxIFByb2plY3QgQ0EwHhcNMjUwMjAzMDg0NzA1WhcNMzUwMjAxMDg0
NzA1WjBAMT4wPAYDVQQDDDVlN2JiNGVlMi0wMGI5LTQyNTEtYjQzOS1hODMwNWJl
MDdhNmEgR0VOIDEgUHJvamVjdCBDQTCCAaIwDQYJKoZIhvcNAQEBBQADggGPADCC
AYoCggGBAJSxPwBCJprg7ubeLlyAIgN0eyV05AH9/qGsYkdHpFLEw9zD9TU3SksL
R3broG8dIgFb8OJ/itosqurinH2DCquCUmZlTRolKM9ub9FHgbUdbYLaxkRXxblE
nYQxe7omjihZ6MOWjjDbG4p07pc+5XNQlVC5MzvGN+NSAgyRb8WKgNmOvy0YJZvY
kvMpPj4x5eU6FWDSPtXiNfVyPmMpq0InNzXTN4k6LvUrcQP3GnoUGc4VOcT197C2
QcRaeJxgxoH2lxPdOoPGEDnikqHU7oIpBzABUGIPe3YfqPWKRVbKNxMCezUbvLgf
LfZJ50fdHhhpku9CY2DRaj9AwcWv+6mO/DHovZuqbdbm+PLv6N7He4TL0k8uc9lh
qbHZuvCm/eT9ei6RaAWKuIV3UlVbknDiO1R6JOiQM/gJy2f0U5yEWXefC6K0hJZ2
z4H63ankFBMovtzURF8cMS164DnbslPxCEKNuPCLA+fzX8Q99ZD+MjoX/Vy2ZeGE
afNCC3ONqwIDAQABoz8wPTAdBgNVHQ4EFgQUmNxI/MNI7f0bbE9VvFGyq0HC4rcw
DwYDVR0TBAgwBgEB/wIBADALBgNVHQ8EBAMCAQYwDQYJKoZIhvcNAQEMBQADggGB
ADvYycj1+qxH8yh/v5B1IUHhaWe7po/8iX26H9WNUl+vlM9w79V9e1EQbkglWzk7
AhWyGKQBkB3LQlXHxW6T/ECJq/MjPcWI0AoDd1Wls2+lnDZaU3OJH20IBlC3dzii
yj1oZe/Ukgh6Y5Z3FTZgVAMZIoyRI4uIeoDh0cRr/3wUGc/M57fP2tbbqV+3bQgJ
0GqBxrT0ODobirtJn6CmZdMIDShMaARdEmpg0tFT6HUION68Hc9uLJLa+iuGybkX
ltUnPBMYYX5YtgOsAUZtoV36y274z8+Of+CfpyS4TWyTgkz1XapFwOrRibOeWkOB
fyYB0hv/ZBRO1U5Wvz+z/fargp23byzu4CsI4sKiQw4CzMMjy5W//JfN+xzySnra
ca/gk5UYVeHXPU+iFic591IVhhkn69gTOeGFJfKND36f2fW01OxIvU9Dz/q0dG8d
Eku5JGX9oM1/9QdL/trWNYKDxTL+Acb+7/zN2waXPdkLngpsamJR69TvyBqvBZcT
vw==
-----END CERTIFICATE-----`,
  },
  max: process.env.MAXIMUM_CLIENTS, // Maximum number of clients in the pool
  idleTimeoutMillis: process.env.CLIENT_EXISTENCE, // How long a client is allowed to remain idle before being closed
});

client.connect(function (err) {
  if (err) {
    console.log(err);
    throw err;
  }

  console.log('Connected To Aiven, Postgresql Database');
});

export default client;
