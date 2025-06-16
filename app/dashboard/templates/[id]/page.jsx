// app/dashboard/templates/[id]/page.js
import EditTemplate from '@/ui/pages/templates/EditTemplate';
import axios from 'axios';
import { notFound } from 'next/navigation';

async function getTemplate(id) {
  let template;
  try {
    const response = await axios.get(
      `https://benew-admin-next15.vercel.app/api/dashboard/templates/${id}`,
    );
    template = response.data.template;
  } catch (error) {
    console.error('Error fetching template:', error);
    // Si le template n'existe pas, rediriger vers 404
    if (error.response?.status === 404) {
      notFound();
    }
    return null;
  }
  return template;
}

const EditTemplatePage = async ({ params }) => {
  const { id } = await params;
  const template = await getTemplate(id);

  // Si le template n'existe pas, afficher 404
  if (!template) {
    notFound();
  }

  return <EditTemplate template={template} />;
};

export default EditTemplatePage;
