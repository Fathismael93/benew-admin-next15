import SingleApplication from '@/ui/pages/applications/SingleApplication';

// eslint-disable-next-line no-unused-vars
async function getSingleApplication(id) {
  let application = [];

  // await axios
  //   .get(
  //     `https://benew-admin-next15.vercel.app/api/dashboard/applications/${id}`,
  //   )
  //   .then((response) => {
  //     application = response.data.application;
  //   })
  //   .catch((error) => console.log(error));

  return application;
}

const SingleApplicationPage = async ({ params }) => {
  const { id } = await params;
  const application = await getSingleApplication(id);

  return <SingleApplication data={application} />;
};

export default SingleApplicationPage;
