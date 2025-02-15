import axios from 'axios';
import ListArticles from '@/ui/pages/blog/ListArticles';

async function getPosts() {
  let articles;
  console.log('We are in the getPosts method');

  await axios
    .get('https://benew-admin-next15.vercel.app/api/dashboard/blog')
    .then((response) => {
      console.log('response articles');
      console.log(response);
      articles = response.data.articles;
    })
    .catch((error) => console.log(error));

  console.log('articles: ');
  console.log(articles);

  return articles;
}

async function Blog() {
  console.log('We are in the Blog server components');
  const articles = await getPosts();

  return <ListArticles articles={articles} />;
}

export default Blog;
