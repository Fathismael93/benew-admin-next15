import ListArticles from '@/ui/pages/blog/ListArticles';
import axios from 'axios';

async function getPosts() {
  let articles;

  await axios
    .get('https://benew-admin-next15.vercel.app/api/dashboard/blog')
    .then((response) => {
      console.log('response articles', response);
      articles = response.data.articles;
    })
    .catch((error) => console.log(error));

  return articles;
}

const BlogPage = async () => {
  const articles = await getPosts();

  return <ListArticles data={articles} />;
};

export default BlogPage;
