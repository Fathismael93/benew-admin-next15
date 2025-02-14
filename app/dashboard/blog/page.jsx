'use client';

import { React, useEffect, useState } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import axios from 'axios';
import { MdAdd } from 'react-icons/md';

import styles from '@/ui/styling/dashboard/blog/blog.module.css';
import Search from '@/ui/components/dashboard/search';
import PostCard from '@/ui/components/dashboard/PostCard';

function Blog() {
  const [posts, setPosts] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  // eslint-disable-next-line no-unused-vars
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(async () => {
    async function getPosts() {
      await axios
        .get('/api/dashboard/blog')
        .then((response) => console.log(response))
        .catch((error) => setErrorMessage(error));
    }

    await getPosts();
  }, []);

  // eslint-disable-next-line camelcase
  const deleteArticle = async (article_id) => {
    await axios
      // eslint-disable-next-line camelcase
      .delete(`/api/dashboard/blog/${article_id}/delete`)
      .then((response) => setIsSuccess(response.data.success))
      .catch((error) => console.error(error));
  };

  if (isSuccess) {
    redirect('/dashboard/blog/');
  }

  return (
    <div className={styles.container}>
      <div className={styles.top}>
        <Search placeholder="Search for a article..." />
        <Link href="/dashboard/blog/add">
          <button className={styles.addButton} type="button">
            <MdAdd /> Article
          </button>
        </Link>
      </div>
      <div className={styles.bottom}>
        {posts.length > 0 ? (
          <div className={styles.dashboardContainer}>
            {posts.map((post) => {
              return (
                <PostCard
                  key={post.article_id}
                  blog_id={post.article_id}
                  title={post.article_title}
                  picture={post.article_image}
                  created={post.created}
                  deleteArticle={deleteArticle}
                />
              );
            })}
          </div>
        ) : (
          <h2 className="error-center">Aucun contenu</h2>
        )}
      </div>
    </div>
  );
}

export default Blog;
