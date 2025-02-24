'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

import { MdAdd } from 'react-icons/md';

import styles from '@/ui/styling/dashboard/blog/blog.module.css';
import Search from '@/ui/components/dashboard/search';
import PostCard from '@/ui/components/dashboard/PostCard';

const ListArticles = ({ data }) => {
  const [articles, setArticles] = useState(data);

  useEffect(() => {
    setArticles(data);
  }, [data]);

  const deleteArticle = async (articleID, articleImage) => {
    try {
      const response = await fetch(`/api/dashboard/blog/${articleID}/delete`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ imageID: articleImage }),
      });

      if (response.ok) {
        // Remove the template from the UI without refreshing
        setIsSuccess(true);
        window.location.reload();
      } else {
        console.error('Failed to delete template');
      }
    } catch (error) {
      console.error('Error deleting template:', error);
    }
  };

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
                  deleteArticle={() =>
                    deleteArticle(post.article_id, post.article_image)
                  }
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
