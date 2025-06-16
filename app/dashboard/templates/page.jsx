import ListTemplates from '@/ui/pages/templates/ListTemplates';

// Configuration de revalidation pour cette page
export const revalidate = 0; // Désactive le cache statique
export const dynamic = 'force-dynamic'; // Force le rendu dynamique

async function getTemplates() {
  let templates = [];

  try {
    const response = await fetch(
      'https://benew-admin-next15.vercel.app/api/dashboard/templates',
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
          Expires: '0',
        },
        cache: 'no-store', // Force pas de cache côté Next.js
        // Ajouter un timestamp pour éviter le cache navigateur
        next: {
          revalidate: 0, // Pas de cache Next.js
          tags: [], // Pas de tags pour éviter la mise en cache
        },
      },
    );

    // Vérifier si la réponse est OK
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    templates = data.templates || [];

    console.log(`✅ Successfully fetched ${templates.length} templates`);
  } catch (error) {
    console.error('❌ Error fetching templates:', error.message);
    // Retourner un tableau vide en cas d'erreur plutôt que de laisser undefined
    templates = [];
  }

  return templates;
}

const TemplatesPage = async () => {
  const templates = await getTemplates();

  return <ListTemplates data={templates} />;
};

export default TemplatesPage;
