'use client';

import { useState } from 'react';
import { redirect } from 'next/navigation';
import { CldUploadWidget, CldImage } from 'next-cloudinary';
import axios from 'axios';
import styles from '@/ui/styling/dashboard/blog/add/add.module.css';
import TiptapEditor from '@/ui/components/dashboard/editor';
import { addArticleSchema } from '@utils/schemas/articleSchema';

const CreatePostPage = () => {
  const [title, setTitle] = useState('');
  const [text, setText] = useState(
    '<p>Start writing your blog post here...</p>',
  );
  const [imageUrl, setImageUrl] = useState('');
  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleEditorChange = (newContent) => {
    setText(newContent);
    // Clear text error when user starts typing
    if (errors.text) {
      setErrors((prev) => ({ ...prev, text: '' }));
    }
  };

  const handleTitleChange = (e) => {
    const value = e.target.value;
    setTitle(value);

    // Clear title error when user starts typing
    if (errors.title) {
      setErrors((prev) => ({ ...prev, title: '' }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrors({});
    setIsLoading(true);

    try {
      // Validate all fields
      await addArticleSchema.validate(
        { title, text, imageUrl },
        { abortEarly: false },
      );

      const response = await axios.post(
        '/api/dashboard/blog/add',
        JSON.stringify({ title, text, imageUrl }),
        {
          headers: { 'Content-Type': 'application/json' },
        },
      );

      if (response.data.success) {
        setIsSuccess(true);
        // Redirect after a short delay
        setTimeout(() => {
          redirect('/dashboard/blog/');
        }, 1500);
      }
    } catch (error) {
      if (error.inner) {
        // Yup validation errors - show specific field errors
        const validationErrors = {};
        error.inner.forEach((err) => {
          validationErrors[err.path] = err.message;
        });
        setErrors(validationErrors);
      } else if (error.response?.data?.message) {
        // Server errors
        setErrors({ general: error.response.data.message });
      } else {
        // Network or other errors
        setErrors({ general: 'Something went wrong. Please try again.' });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const getTextLength = () => {
    // Remove HTML tags to count actual text length
    const textContent = text.replace(/<[^>]*>/g, '');
    return textContent.length;
  };

  if (isSuccess) {
    return (
      <section className={styles.createPostContainer}>
        <div className={styles.successContainer}>
          <h2>✅ Article Created Successfully!</h2>
          <p>Redirecting to blog dashboard...</p>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.createPostContainer}>
      <div className={styles.createPostTitle}>
        <h2>Create Post</h2>
      </div>

      <form className={styles.createPostForm} onSubmit={handleSubmit}>
        {/* General Error Message */}
        {errors.general && (
          <div className={styles.errorMessage}>⚠️ {errors.general}</div>
        )}

        {/* Title Field */}
        <div className={styles.inputGroup}>
          <input
            type="text"
            name="title"
            placeholder="Title"
            value={title}
            onChange={handleTitleChange}
            className={errors.title ? styles.inputError : ''}
            maxLength={200}
          />
          <div className={styles.inputInfo}>
            <span className={styles.charCount}>
              {title.length}/200 characters
              {title.length >= 10
                ? ' ✓'
                : ` (${10 - title.length} more needed)`}
            </span>
          </div>
          {errors.title && (
            <div className={styles.fieldError}>⚠️ {errors.title}</div>
          )}
        </div>

        {/* Content Editor */}
        <div className={styles.inputGroup}>
          <div className={errors.text ? styles.editorError : ''}>
            <TiptapEditor text={text} handleEditorChange={handleEditorChange} />
          </div>
          <div className={styles.inputInfo}>
            <span className={styles.charCount}>
              {getTextLength()}/10000 characters
              {getTextLength() >= 500
                ? ' ✓'
                : ` (${500 - getTextLength()} more needed)`}
            </span>
          </div>
          {errors.text && (
            <div className={styles.fieldError}>⚠️ {errors.text}</div>
          )}
        </div>

        {/* Image Upload */}
        <div className={styles.inputGroup}>
          <CldUploadWidget
            signatureEndpoint="/api/dashboard/blog/add/sign-image"
            onSuccess={(result) => {
              setImageUrl(result?.info.public_id);
              setErrors((prev) => ({ ...prev, imageUrl: '' }));
            }}
            options={{
              folder: 'blog_pictures',
              maxFileSize: 10000000, // 10MB
              resourceType: 'image',
              clientAllowedFormats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
            }}
          >
            {({ open }) => {
              const canUpload = title.length > 10;

              return (
                <div>
                  <button
                    className={`${styles.addImage} ${!canUpload ? styles.disabled : ''} ${imageUrl ? styles.success : ''}`}
                    onClick={(e) => {
                      e.preventDefault();
                      if (canUpload) open();
                    }}
                    type="button"
                    disabled={!canUpload}
                  >
                    {imageUrl ? '✓ Change Image' : '📷 Add Image'}
                  </button>

                  {!canUpload && (
                    <p className={styles.uploadHint}>
                      Complete the title first (10+ characters) to upload an
                      image
                    </p>
                  )}
                </div>
              );
            }}
          </CldUploadWidget>

          {imageUrl && (
            <div className={styles.postDetailImage}>
              <CldImage
                width="400"
                height="400"
                src={imageUrl}
                sizes="100vw"
                alt="Image illustration of the article"
              />
              <button
                type="button"
                className={styles.removeImage}
                onClick={() => setImageUrl('')}
              >
                ✕ Remove
              </button>
            </div>
          )}

          {errors.imageUrl && (
            <div className={styles.fieldError}>⚠️ {errors.imageUrl}</div>
          )}
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          className={`${styles.addButton} ${isLoading ? styles.loading : ''}`}
          disabled={isLoading}
        >
          {isLoading ? '⏳ Creating...' : '✨ Create'}
        </button>

        {/* Form Status */}
        <div className={styles.formStatus}>
          <p>
            📝 Title: {title.length >= 10 ? '✅' : '❌'} | 📄 Content:{' '}
            {getTextLength() >= 500 ? '✅' : '❌'} | 🖼️ Image:{' '}
            {imageUrl ? '✅' : '❌'}
          </p>
        </div>
      </form>
    </section>
  );
};

export default CreatePostPage;
