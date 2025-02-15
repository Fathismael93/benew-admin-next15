import axios from 'axios';
import ListArticles from '@/ui/pages/blog/ListArticles';

async function getPosts() {
  let articles;

  await axios
    .get('https://benew-admin-next15.vercel.app/api/dashboard/blog')
    .then((response) => {
      console.log('response: ');
      console.log(response.data);
      articles = response.data.articles;
    })
    .catch((error) => console.log(error));

  return articles;
}

async function BlogPage() {
  const articles = await getPosts();

  return <ListArticles articles={articles} />;
}

export default BlogPage;
