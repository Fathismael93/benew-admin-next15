import axios from 'axios';
import { articleIDSchema } from '@/utils/schemas';
import SingleArticle from '@/ui/pages/blog/SingleArticle';

async function getSinglePost(id) {
  let data;
  try {
    await articleIDSchema.validate({ id });

    await axios
      .get(
        `https://benew-admin-next15.vercel.app/api/dashboard/blog/${id}/view`,
      )
      .then((response) => {
        console.log('response');
        console.log(response.data);
        data = response.data.data;
      })
      .catch((e) => {
        console.log('Axios catch');
        console.log('Article inexistant !');
        console.log(e);
      });

    return data;
  } catch (error) {
    console.log('try catch');
    console.log('Article inexistant !');
    console.log(error);
  }
}

async function ViewArticle({ params }) {
  const { id } = await params;

  await getSinglePost(id);

  return <SingleArticle />;
}

export default ViewArticle;
