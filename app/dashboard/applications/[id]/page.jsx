import React from 'react';
import SingleApplication from '@/ui/pages/applications/SingleApplication';
import axios from 'axios';

async function getSingleApplication(id) {
  let application;

  await axios
    .get(
      `https://benew-admin-next15.vercel.app/api/dashboard/applications/${id}`,
    )
    .then((response) => {
      application = response.data.application;
    })
    .catch((error) => console.log(error));

  return application;
}

const SingleApplicationPage = async ({ params }) => {
  const { id } = await params;
  const application = await getSingleApplication(id);

  return <SingleApplication application={application} />;
};

export default SingleApplicationPage;
