'use client';

import { React, useState } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CldImage } from 'next-cloudinary';
import parse from 'html-react-parser';
import styles from '@/ui/styling/dashboard/blog/view-article/view.module.css';

const SingleArticle = ({ data }) => {
  const [article, setArticle] = useState(data);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  console.log('article state value');
  console.log(article);

  // eslint-disable-next-line camelcase
  const deleteArticle = async (article_id) => {
    await axios
      // eslint-disable-next-line camelcase
      .delete(`/api/dashboard/blog/${article_id}/delete`)
      .then((response) => setIsSuccess(response.data.success))
      .catch((error) => console.log(error));
  };

  if (isSuccess) {
    redirect('/dashboard/blog/');
  }

  return (
    <section>
      {article ? (
        <div className={styles.postDetailContainer}>
          <div className={styles.postDetailTop}>
            <p className={styles.dateWritten}>
              {article && <span>{`Publié le ${article.created}`}</span>}
            </p>
            <div className={styles.postDetailButtons}>
              <Link href={`blog/${id}/edit`}>
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
                onClick={() => deleteArticle(id)}
              >
                Delete
              </button>
            </div>
          </div>
          <h1>{article && article.article_title}</h1>
          <div className={styles.postDetailImage}>
            <CldImage
              priority
              src={article.article_image}
              alt="Image illustration of the article"
              width={750}
              height={500}
              style={{ width: '100%', height: 'auto' }}
            />
          </div>
          <div className={styles.postDetailPara}>
            {article && parse(article.article_text)}
          </div>
        </div>
      ) : (
        <h2 className="error-center">{errorMessage}</h2>
      )}
    </section>
  );
};

export default SingleArticle;
