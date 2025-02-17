'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import axios from 'axios';
import { MdAdd } from 'react-icons/md';

import styles from '@/ui/styling/dashboard/blog/blog.module.css';
import Search from '@/ui/components/dashboard/search';
import PostCard from '@/ui/components/dashboard/PostCard';

const ListArticles = ({ articles }) => {
  const [isSuccess, setIsSuccess] = useState(false);
  // eslint-disable-next-line no-unused-vars
  const [errorMessage, setErrorMessage] = useState('');
  const router = useRouter();

  // eslint-disable-next-line camelcase
  const deleteArticle = async (article_id) => {
    await axios
      // eslint-disable-next-line camelcase
      .delete(
        `https://benew-admin-next15.vercel.app/api/dashboard/blog/${article_id}/delete`,
      )
      .then((response) => setIsSuccess(response.data.success))
      .catch((error) => console.error(error));
  };

  if (isSuccess) {
    router.push('/dashboard/blog/');
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
        {articles !== undefined && articles.length > 0 ? (
          <div className={styles.dashboardContainer}>
            {articles.map((post) => {
              return (
                <PostCard
                  key={post.article_id}
                  blog_id={post.article_id}
                  title={post.article_title}
                  picture={post.article_image}
                  created={post.created}
                  deleteArticle={() => deleteArticle()}
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
};

export default ListArticles;
