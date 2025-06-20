// app/dashboard/platforms/page.js (Server Component)

import PlatformsList from '@/ui/pages/platforms/PlatformsList';

async function getPlatforms() {
  let platforms = [];

  // await axios
  //   .get('https://benew-admin-next15.vercel.app/api/dashboard/platforms')
  //   .then((response) => {
  //     platforms = response.data.platforms;
  //   })
  //   .catch((error) => console.log(error));

  return platforms;
}

const PlatformsPage = async () => {
  const platforms = await getPlatforms();

  return <PlatformsList data={platforms} />;
};

export default PlatformsPage;
