import axios from 'axios';
import ListArticles from '@/ui/pages/blog/ListArticles';

async function getPosts() {
  let articles = [];

  // await axios
  //   .get('https://benew-admin-next15.vercel.app/api/dashboard/blog')
  //   .then((response) => {
  //     articles = response.data.articles;
  //   })
  //   .catch((error) => console.log(error));

  return articles;
}

const BlogPage = async () => {
  const articles = await getPosts();

  return <ListArticles data={articles} />;
};

export default BlogPage;
