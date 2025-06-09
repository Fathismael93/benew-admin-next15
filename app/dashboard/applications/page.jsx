// app/dashboard/applications/page.js (Server Component)

import React from 'react';
import ApplicationsList from '@/ui/pages/applications/ApplicationsList';
import axios from 'axios';

async function getApplications() {
  let applications = [];

  // await axios
  //   .get('https://benew-admin-next15.vercel.app/api/dashboard/applications')
  //   .then((response) => {
  //     applications = response.data.applications;
  //   })
  //   .catch((error) => console.log(error));

  return applications;
}

const ApplicationsPage = async () => {
  const applications = await getApplications();

  return <ApplicationsList data={applications} />;
};

export default ApplicationsPage;
