'use client';

import { useState } from 'react';
import { redirect } from 'next/navigation';
import { CldUploadWidget, CldImage } from 'next-cloudinary';
import axios from 'axios';
import styles from '@/ui/styling/dashboard/blog/add/add.module.css';
import { addArticleSchema } from '@/utils/schemas.js';
import TiptapEditor from '@/ui/components/dashboard/editor';

const CreatePostPage = () => {
  const [title, setTitle] = useState('');
  const [text, setText] = useState(
    '<p>Start writing your blog post here...</p>',
  ); // State to store editor content
  const [imageUrl, setImageUrl] = useState('');
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
        .post(
          '/api/dashboard/blog/add',
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
    <section className={styles.createPostContainer}>
      <div className={styles.createPostTitle}>
        <h2>Create Post</h2>
      </div>
      <form className={styles.createPostForm} onSubmit={(e) => handleSubmit(e)}>
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
            folder: 'blog_pictures', // Specify the folder here
          }}
        >
          {({ open }) => {
            function handleOnClick(e) {
              e.preventDefault();
              title.length > 10 && open();
            }
            return (
              <button
                className={styles.addImage}
                onClick={handleOnClick}
                type="button"
              >
                Add Image
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
        <button type="submit" className={styles.addButton}>
          Create
        </button>
      </form>
    </section>
  );
};

export default CreatePostPage;
