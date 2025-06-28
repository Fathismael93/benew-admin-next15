'use server';

import { getClient } from '@backend/dbConnect';

export async function getFilteredApplications(filters = {}) {
  let client;

  try {
    client = await getClient();

    // Construction dynamique de la clause WHERE
    const conditions = [];
    const values = [];
    let paramCount = 1;

    if (filters.application_name) {
      conditions.push(`application_name ILIKE $${paramCount}`);
      values.push(`%${filters.application_name}%`);
      paramCount++;
    }

    if (filters.application_level) {
      conditions.push(`application_level = $${paramCount}`);
      values.push(filters.application_level);
      paramCount++;
    }

    if (filters.is_active !== undefined) {
      conditions.push(`is_active = $${paramCount}`);
      values.push(filters.is_active);
      paramCount++;
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT application_id, application_name, application_images, 
             application_fee, application_rent, application_link, 
             application_level, is_active, created_at, sales_count, updated_at
      FROM catalog.applications
      ${whereClause}
      ORDER BY created_at DESC
    `;

    const result = await client.query(query, values);

    // Même sanitisation que votre code existant
    const sanitizedApplications = result.rows.map((app) => ({
      application_id: app.application_id,
      application_name: app.application_name || '[No Name]',
      application_images: app.application_images,
      application_fee: parseFloat(app.application_fee) || 0,
      application_rent: parseFloat(app.application_rent) || 0,
      application_link: app.application_link,
      application_level: app.application_level || '1',
      application_added: app.created_at,
      is_active: Boolean(app.is_active),
      sales_count: parseInt(app.sales_count) || 0,
      updated_at: app.updated_at,
    }));

    if (client) await client.cleanup();
    return sanitizedApplications;
  } catch (error) {
    if (client) await client.cleanup();
    throw error;
  }
}
