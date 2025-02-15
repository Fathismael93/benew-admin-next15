import axios from 'axios';
import ListArticles from '@/ui/pages/blog/ListArticles';

async function getPosts() {
  let articles;

  await axios
    .get('https://benew-admin-next15.vercel.app/api/dashboard/blog')
    .then((response) => {
      console.log('response: ');
      console.log(response.data);
      articles = response;
    })
    .catch((error) => console.log(error));

  return articles;
}

const BlogPage = async () => {
  const articles = await getPosts();

  console.log('articles in BlogPage:');
  console.log(articles);

  return <ListArticles articles={articles} />;
};

export default BlogPage;
