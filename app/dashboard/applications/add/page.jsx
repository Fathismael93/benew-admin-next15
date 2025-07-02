import AddApplication from '@/ui/pages/applications/AddApplication';

async function getTemplates() {
  let templates = [];

  try {
    const response = await fetch(
      'https://benew-admin-next15.vercel.app/api/dashboard/templates',
    );

    // Vérifier si la réponse est ok
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    templates = data.templates;
  } catch (error) {
    console.log('Error fetching templates:', error);
  }

  return templates;
}

const NewApplicationPage = async () => {
  const templates = await getTemplates();

  return <AddApplication templates={templates} />;
};

export default NewApplicationPage;
