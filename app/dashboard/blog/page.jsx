import React from 'react';
import axios from 'axios';
import ListArticles from '@/ui/pages/blog/ListArticles';

async function getPosts() {
  let articles;

  await axios
    .get('https://benew-admin-next15.vercel.app/api/dashboard/blog')
    .then((response) => (articles = response.data.articles))
    .catch((error) => console.log(error));

  console.log('articles: ');
  console.log(articles);

  return articles;
}

async function Blog() {
  const articles = await getPosts();

  return <ListArticles articles={articles} />;
}

export default Blog;
