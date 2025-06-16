import ListTemplates from '@/ui/pages/templates/ListTemplates';
import axios from 'axios';

// Configuration de revalidation pour cette page
export const revalidate = 0; // Désactive le cache statique
export const dynamic = 'force-dynamic'; // Force le rendu dynamique

async function getTemplates() {
  let templates = [];

  try {
    const response = await axios.get(
      'https://benew-admin-next15.vercel.app/api/dashboard/templates',
      {
        // Désactiver le cache axios aussi
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
          Expires: '0',
        },
        // Ajouter un timestamp pour éviter le cache navigateur
        params: {
          _t: Date.now(),
        },
      },
    );
    templates = response.data.templates;
  } catch (error) {
    console.error('Error fetching templates:', error);
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
