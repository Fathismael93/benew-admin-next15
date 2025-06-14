// app/dashboard/templates/[id]/page.js
import EditTemplate from '@/ui/pages/templates/EditTemplate';
import axios from 'axios';

async function getTemplate(id) {
  let template;
  try {
    const response = await axios.get(
      `https://benew-admin-next15.vercel.app/api/dashboard/templates/${id}`,
    );
    template = response.data.template;
  } catch (error) {
    console.error('Error fetching template:', error);
  }
  return template;
}

const EditTemplatePage = async ({ params }) => {
  const { id } = await params;
  const template = await getTemplate(id);

  return <EditTemplate template={template} />;
};

export default EditTemplatePage;
