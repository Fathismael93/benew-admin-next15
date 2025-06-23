'use client';
import { useState } from 'react';
import { redirect } from 'next/navigation';
import { CldUploadWidget, CldImage } from 'next-cloudinary';
import axios from 'axios';
import styles from '@/ui/styling/dashboard/blog/edit/edit.module.css';
import TiptapEditor from '@/ui/components/dashboard/editor';
import { addArticleSchema } from '@utils/schemas/articleSchema';

const EditArticle = ({ data }) => {
  const [title, setTitle] = useState(data?.article_title || '');
  const [text, setText] = useState(data?.article_text || '');
  const [imageUrl, setImageUrl] = useState(data?.article_image || '');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);

  const handleEditorChange = (newContent) => {
    setText(newContent);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');
    try {
      await addArticleSchema.validate(
        {
          title,
          text,
          imageUrl,
        },
        { abortEarly: false },
      );

      await axios
        .put(
          `/api/dashboard/blog/${data.article_id}/edit`,
          JSON.stringify({ title, text, imageUrl }),
          {
            headers: { 'Content-Type': 'application/json' },
          },
        )
        .then((response) => {
          setIsSuccess(response.data.success);
        })
        .catch((error) => {
          setErrorMessage(error.message);
        });
    } catch (error) {
      setErrorMessage(error.inner[0].message);
    }
  };

  if (isSuccess) {
    redirect('/dashboard/blog/');
  }

  return (
    <section className={styles.editPostContainer}>
      <div className={styles.editPostTitle}>
        <h2>Edit Post</h2>
      </div>
      <form className={styles.editPostForm} onSubmit={handleSubmit}>
        {errorMessage && <p className={styles.errorMessage}>{errorMessage}</p>}
        <input
          type="text"
          name="title"
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <TiptapEditor text={text} handleEditorChange={handleEditorChange} />
        <CldUploadWidget
          signatureEndpoint="/api/dashboard/blog/add/sign-image"
          onSuccess={(result) => {
            setImageUrl(result?.info.public_id);
          }}
          options={{
            folder: 'blog_pictures',
          }}
        >
          {({ open }) => {
            function handleOnClick(e) {
              e.preventDefault();
              title.length > 10 && open();
            }
            return (
              <button
                className={styles.changeImage}
                onClick={handleOnClick}
                type="button"
              >
                Change Image
              </button>
            );
          }}
        </CldUploadWidget>
        <div className={styles.postDetailImage}>
          {imageUrl && (
            <CldImage
              width="400"
              height="400"
              src={imageUrl}
              sizes="100vw"
              alt="Image illustration of the article"
            />
          )}
        </div>
        <button type="submit" className={styles.updateButton}>
          Update
        </button>
      </form>
    </section>
  );
};

export default EditArticle;
