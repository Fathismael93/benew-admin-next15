import EditApplication from '@/ui/pages/applications/EditApplication';

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

const EditApplicationPage = async ({ params }) => {
  const { id } = await params;
  const application = await getSingleApplication(id);

  return <EditApplication application={application} />;
};

export default EditApplicationPage;
