'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CldImage } from 'next-cloudinary';
import parse from 'html-react-parser';
import styles from '@/ui/styling/dashboard/blog/view-article/view.module.css';

const SingleArticle = ({ data }) => {
  const [errorMessage, setErrorMessage] = useState('');
  const router = useRouter();

  // eslint-disable-next-line camelcase
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
        router.push('/dashboard/blog/');
      } else {
        console.error('Failed to delete template');
      }
    } catch (error) {
      console.error('Error deleting template:', error);
    }
  };

  return (
    <section>
      {data ? (
        <div className={styles.postDetailContainer}>
          <div className={styles.postDetailTop}>
            <p className={styles.dateWritten}>
              {data && <span>{`Publié le ${data.created}`}</span>}
            </p>
            <div className={styles.postDetailButtons}>
              <Link
                href={`https://benew-admin-next15.vercel.app/dashboard/blog/${data.article_id}/edit`}
              >
                <button
                  type="button"
                  className={`${styles.addButton} ${styles.edit}`}
                >
                  Edit
                </button>
              </Link>
              <button
                type="button"
                className={`${styles.addButton} ${styles.delete}`}
                onClick={() =>
                  deleteArticle(data.article_id, data.article_image)
                }
              >
                Delete
              </button>
            </div>
          </div>
          <h1>{data && data.article_title}</h1>
          <div className={styles.postDetailImage}>
            <CldImage
              priority
              src={data.article_image}
              alt="Image illustration of the article"
              width={750}
              height={500}
              style={{ width: '100%', height: 'auto' }}
            />
          </div>
          <div className={styles.postDetailPara}>
            {data && parse(data.article_text)}
          </div>
        </div>
      ) : (
        <h2 className="error-center">{errorMessage}</h2>
      )}
    </section>
  );
};

export default SingleArticle;
