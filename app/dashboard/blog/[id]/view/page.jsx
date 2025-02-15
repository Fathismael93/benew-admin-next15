import axios from 'axios';
import { articleIDSchema } from '@/utils/schemas';
// import SingleArticle from '@/ui/pages/blog/SingleArticle';

async function getSinglePost() {
  try {
    await articleIDSchema.validate({ id });

    await axios
      .get(`/api/dashboard/blog/${id}/view`)
      .then((response) => {
        console.log('response');
        console.log(response);
      })
      .catch(() => {
        console.log('Article inexistant !');
      });
  } catch (error) {
    console.log('Article inexistant !');
  }
}

async function ViewArticle({ params }) {
  const { id } = await params;

  await getSinglePost(id);

  return <p>Test Réussi</p>;
}

export default ViewArticle;
