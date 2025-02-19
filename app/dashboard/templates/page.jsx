import React from 'react';
import axios from 'axios';
import ListTemplates from '@/ui/pages/templates/ListTemplates';

async function getTemplates() {
  let response;

  await axios
    .get('https://benew-admin-next15.vercel.app/api/dashboard/templates')
    .then((response) => {
      console.log('response in getTemplates: ');
      console.log(response);
      response = response;
    })
    .catch((error) => console.log(error));

  return response;
}

const TemplatePage = async () => {
  const response = await getTemplates();

  return <ListTemplates response={response} />;
};

export default TemplatePage;
