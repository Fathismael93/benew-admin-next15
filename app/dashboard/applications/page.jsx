// app/dashboard/applications/page.jsx (Server Component)

import ApplicationsList from '@/ui/pages/applications/ApplicationsList';
import axios from 'axios';

// Configuration de revalidation pour cette page
export const revalidate = 0; // Désactive le cache statique
export const dynamic = 'force-dynamic'; // Force le rendu dynamique

async function getApplications() {
  let applications = [];

  try {
    const response = await axios.get(
      'https://benew-admin-next15.vercel.app/api/dashboard/applications',
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
    applications = response.data.applications;
  } catch (error) {
    console.error('Error fetching applications:', error);
    // Retourner un tableau vide en cas d'erreur plutôt que de laisser undefined
    applications = [];
  }

  return applications;
}

const ApplicationsPage = async () => {
  const applications = await getApplications();

  return <ApplicationsList data={applications} />;
};

export default ApplicationsPage;
