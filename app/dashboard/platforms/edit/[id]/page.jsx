import EditPlatform from '@ui/pages/platforms/EditPlatform';
import axios from 'axios';

async function getPlatform(id) {
  let platform;
  try {
    const response = await axios.get(
      `https://benew-admin-next15.vercel.app/api/dashboard/platforms/${id}`,
    );

    platform = response.data.platform;
  } catch (error) {
    console.error('Error fetching platform:', error);
    return null;
  }
  return platform;
}

const EditPlatformPage = async ({ params }) => {
  const { id } = await params;
  const platform = await getPlatform(id);

  return <EditPlatform platform={platform} />;
};

export default EditPlatformPage;
