/* eslint-disable camelcase */
import React from 'react';
import { CldImage } from 'next-cloudinary';
import Link from 'next/link';
import styles from './postCard.module.css';

function PostCard({ blog_id, title, picture, created, deleteArticle }) {
  return (
    <article key={blog_id} className={styles.dashboardPost}>
      <div className={styles.dashboardPostInfo}>
        <CldImage
          priority
          src={picture}
          alt="Image de l'article"
          width={200}
          height={130}
          className={styles.dashboardPostImage}
          style={{ width: '100%', height: 'auto' }}
        />
        <h5 className={styles.title}>
          {title}
          <br />
          <br />
          <em className={styles.dateCreated}>{`Publié le ${created}`}</em>
        </h5>
      </div>
      <div className={styles.dashboardPostAction}>
        <Link href={`blog/${blog_id}/view`}>
          <button
            type="button"
            className={`${styles.addButton} ${styles.view}`}
          >
            View
          </button>
        </Link>
        <Link href={`blog/${blog_id}/edit`}>
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
          onClick={() => deleteArticle(blog_id)}
        >
          Delete
        </button>
      </div>
    </article>
  );
}

export default PostCard;
