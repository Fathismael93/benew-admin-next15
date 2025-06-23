// app/dashboard/platforms/page.jsx (Server Component)

import PlatformsList from '@/ui/pages/platforms/PlatformsList';
import axios from 'axios';

// Configuration de revalidation pour cette page
export const revalidate = 0; // Désactive le cache statique
export const dynamic = 'force-dynamic'; // Force le rendu dynamique

async function getPlatforms() {
  let platforms = [];

  try {
    const response = await axios.get(
      'https://benew-admin-next15.vercel.app/api/dashboard/platforms',
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
    platforms = response.data.platforms;
  } catch (error) {
    console.error('Error fetching platforms:', error);
    // Retourner un tableau vide en cas d'erreur plutôt que de laisser undefined
    platforms = [];
  }

  return platforms;
}

const PlatformsPage = async () => {
  const platforms = await getPlatforms();

  return <PlatformsList data={platforms} />;
};

export default PlatformsPage;
