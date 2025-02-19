import React from 'react';
import ListTemplates from '@/ui/pages/templates/ListTemplates';

async function getTemplates() {
  let articles;

  await axios
    .get('https://benew-admin-next15.vercel.app/api/dashboard/templates')
    .then((response) => {
      console.log('response in getTemplates: ');
      console.log(response);
    })
    .catch((error) => console.log(error));

  return [];
}

const TemplatePage = async () => {
  await getTemplates();

  return <ListTemplates />;
};

export default TemplatePage;
