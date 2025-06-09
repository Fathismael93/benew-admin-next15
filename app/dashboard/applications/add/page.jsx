import React from 'react';
import AddApplication from '@/ui/pages/applications/AddApplication';
import axios from 'axios';

async function getTemplates() {
  let templates = [];

  // await axios
  //   .get('https://benew-admin-next15.vercel.app/api/dashboard/templates')
  //   .then((response) => {
  //     templates = response.data.templates;
  //   })
  //   .catch((error) => console.log(error));

  return templates;
}

const NewApplicationPage = async () => {
  const templates = await getTemplates();

  return <AddApplication templates={templates} />;
};

export default NewApplicationPage;
