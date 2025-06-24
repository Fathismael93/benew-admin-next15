import EditArticle from '@/ui/pages/blog/EditArticle';
import { articleIDSchema } from '@utils/schemas/articleSchema';
import axios from 'axios';

// eslint-disable-next-line no-unused-vars
async function getSinglePost(id) {
  let data;
  try {
    await articleIDSchema.validate({ id });
    await axios
      .get(
        `https://benew-admin-next15.vercel.app/api/dashboard/blog/${id}/view`,
      )
      .then((response) => {
        data = response.data.data;
      })
      .catch((e) => {
        console.log(e);
      });
    return data;
  } catch (error) {
    console.log(error);
  }
}

const SingleArticleEditingPage = async ({ params }) => {
  const { id } = await params;
  const data = await getSinglePost(id);
  return <EditArticle data={data} />;
};

export default SingleArticleEditingPage;
