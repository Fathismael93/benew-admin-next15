'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CldImage } from 'next-cloudinary';
import parse from 'html-react-parser';
import styles from '@/ui/styling/dashboard/blog/view-article/view.module.css';

const SingleArticle = ({ data }) => {
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const router = useRouter();

  // eslint-disable-next-line camelcase
  const deleteArticle = async (article_id) => {
    await axios
      // eslint-disable-next-line camelcase
      .delete(`/api/dashboard/blog/${article_id}/delete`)
      .then((response) => setIsSuccess(response.data.success))
      .catch((error) => console.log(error));
  };

  if (isSuccess) {
    router.push('/dashboard/blog/');
  }

  return (
    <section>
      {/* {data ? (
        <div className={styles.postDetailContainer}>
          <div className={styles.postDetailTop}>
            <p className={styles.dateWritten}>
              {data && <span>{`Publié le ${data.created}`}</span>}
            </p>
            <div className={styles.postDetailButtons}>
              <Link href={`blog/${data.article_id}/edit`}>
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
                onClick={() => deleteArticle(data.article_id)}
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
      )} */}
    </section>
  );
};

export default SingleArticle;
