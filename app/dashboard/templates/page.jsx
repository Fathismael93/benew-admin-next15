import ListTemplates from '@/ui/pages/templates/ListTemplates';
import axios from 'axios';

async function getTemplates() {
  let templates = [];

  await axios
    .get('https://benew-admin-next15.vercel.app/api/dashboard/templates')
    .then((response) => {
      templates = response.data.templates;
    })
    .catch((error) => console.log(error));

  return templates;
}

const TemplatesPage = async () => {
  const templates = await getTemplates();

  return <ListTemplates data={templates} />;
};

export default TemplatesPage;
