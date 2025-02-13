'use client';

import React, { useEffect, useState } from 'react';
import { redirect } from 'next/navigation';
import { useQuill } from 'react-quilljs';
import 'quill/dist/quill.bubble.css'; // Add css for bubble theme
import { CldUploadWidget, CldImage } from 'next-cloudinary';
import axios from 'axios';
import {
  modules,
  formats,
  theme,
  placeholder,
} from '@/utils/reactquillConfig.js';
import styles from '@/ui/styling/dashboard/blog/add/add.module.css';
import { addArticleSchema } from '@/utils/schemas.js';

const CreatePost = () => {
  const { quill, quillRef } = useQuill({
    modules: {
      toolbar: '#toolbar',
    },
    theme,
    formats,
    placeholder,
  });

  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    if (quill) {
      quill.on('text-change', (delta, oldDelta, source) => {
        console.log('Text change!');
        console.log(quill.getText()); // Get text only
        console.log(quill.getContents()); // Get delta contents
        console.log(quill.root.innerHTML); // Get innerHTML using quill
        console.log(quillRef.current.firstChild.innerHTML); // Get innerHTML using quillRef
      });
    }
  }, [quill]);

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

        {/* <QuillEditor
          className={styles.editor}
          modules={modules}
          formats={formats}
          value={text}
          onChange={handleEditorChange}
        /> */}

        <div className={styles.editor}>
          <div ref={quillRef} />

          <div id="toolbar">
            <select className="ql-size">
              <option value="small" />
              <option selected />
              <option value="large" />
              <option value="huge" />
            </select>
            <button className="ql-bold" />
            <button className="ql-script" value="sub" />
            <button className="ql-script" value="super" />
          </div>
          <div id="editor" />
        </div>

        <CldUploadWidget
          signatureEndpoint="/api/dashboard/blog/add/sign-image"
          onSuccess={(result) => {
            setImageUrl(result?.info.public_id);
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

export default CreatePost;
