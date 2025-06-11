/* eslint-disable no-unused-vars */

import { articleIDSchema } from '@/utils/schemas';
import SingleArticle from '@/ui/pages/blog/SingleArticle';

async function getSinglePost(id) {
  let data = [];
  try {
    // await articleIDSchema.validate({ id });

    // await axios
    //   .get(
    //     `https://benew-admin-next15.vercel.app/api/dashboard/blog/${id}/view`,
    //   )
    //   .then((response) => {
    //     data = response.data.data;
    //   })
    //   .catch((e) => {
    //     console.log(e);
    //   });

    // console.log(data);

    return data;
  } catch (error) {
    console.log(error);
  }
}

async function ViewArticlePage({ params }) {
  const { id } = await params;

  const data = await getSinglePost(id);

  return <SingleArticle article={data} />;
}

export default ViewArticlePage;
