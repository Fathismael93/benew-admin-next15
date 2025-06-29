'use server';

import { getClient } from '@backend/dbConnect';
import { generateRequestId } from '@/utils/helpers';
import logger from '@/utils/logger';
import { captureDatabaseError } from '@/monitoring/sentry';

export async function getFilteredApplications(filters = {}) {
  let client;
  const requestId = generateRequestId();

  try {
    client = await getClient();

    // Construction dynamique de la clause WHERE (MÊME LOGIQUE que page.jsx)
    const conditions = [];
    const values = [];
    let paramCount = 1;

    // Recherche par nom
    if (filters.application_name) {
      conditions.push(`application_name ILIKE $${paramCount}`);
      values.push(`%${filters.application_name}%`);
      paramCount++;
    }

    // Filtre par catégorie (MULTIPLE)
    if (filters.category && filters.category.length > 0) {
      const categoryPlaceholders = filters.category
        .map(() => `$${paramCount++}`)
        .join(', ');
      conditions.push(`application_category IN (${categoryPlaceholders})`);
      values.push(...filters.category);
    }

    // Filtre par level (MULTIPLE)
    if (filters.level && filters.level.length > 0) {
      const levelPlaceholders = filters.level
        .map(() => `$${paramCount++}`)
        .join(', ');
      conditions.push(`application_level IN (${levelPlaceholders})`);
      values.push(...filters.level);
    }

    // Filtre par status (MULTIPLE)
    if (filters.status && filters.status.length > 0) {
      const statusPlaceholders = filters.status
        .map(() => `$${paramCount++}`)
        .join(', ');
      conditions.push(`is_active IN (${statusPlaceholders})`);
      values.push(...filters.status.map((s) => s === 'true'));
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT 
        application_id, 
        application_name, 
        application_images,
        application_category, 
        application_fee, 
        application_rent, 
        application_link, 
        application_level,
        is_active,
        created_at,
        sales_count,
        updated_at
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
      application_category: app.application_category || 'web',
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
    // Log de l'erreur
    logger.error('Server Action Error', {
      error: error.message,
      requestId,
      filters,
    });

    captureDatabaseError(error, {
      tags: { component: 'server_action', action: 'filter_applications' },
      extra: { requestId, filters },
    });

    if (client) await client.cleanup();
    throw error;
  }
}
