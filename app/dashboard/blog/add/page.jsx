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
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);

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

    // Real-time validation feedback
    if (value.length > 0 && value.length < 10) {
      setErrors((prev) => ({
        ...prev,
        title: `Title needs ${10 - value.length} more characters`,
      }));
    }
  };

  const validateField = (field, value) => {
    try {
      const schema = addArticleSchema.pick([field]);
      schema.validateSync({ [field]: value });
      return null;
    } catch (error) {
      return error.message;
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
        setShowSuccessMessage(true);

        // Redirect after showing success message
        setTimeout(() => {
          redirect('/dashboard/blog/');
        }, 2000);
      }
    } catch (error) {
      if (error.inner) {
        // Yup validation errors
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

  const getFieldClass = (fieldName) => {
    if (errors[fieldName]) return `${styles.inputField} ${styles.inputError}`;
    if (fieldName === 'title' && title.length >= 10)
      return `${styles.inputField} ${styles.inputSuccess}`;
    return styles.inputField;
  };

  const getTextLength = () => {
    // Remove HTML tags to count actual text length
    const textContent = text.replace(/<[^>]*>/g, '');
    return textContent.length;
  };

  if (showSuccessMessage) {
    return (
      <section className={styles.createPostContainer}>
        <div className={styles.successContainer}>
          <div className={styles.successIcon}>✓</div>
          <h2>Article Created Successfully!</h2>
          <p>Redirecting to blog dashboard...</p>
          <div className={styles.loadingSpinner}></div>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.createPostContainer}>
      <div className={styles.createPostHeader}>
        <h2>Create New Article</h2>
        <p>Share your thoughts with the world</p>
      </div>

      <form className={styles.createPostForm} onSubmit={handleSubmit}>
        {errors.general && (
          <div className={styles.errorAlert}>
            <span className={styles.errorIcon}>!</span>
            {errors.general}
          </div>
        )}

        {/* Title Field */}
        <div className={styles.fieldGroup}>
          <label htmlFor="title" className={styles.fieldLabel}>
            Article Title
            <span className={styles.required}>*</span>
          </label>
          <input
            type="text"
            id="title"
            name="title"
            placeholder="Enter an engaging title for your article..."
            value={title}
            onChange={handleTitleChange}
            className={getFieldClass('title')}
            maxLength={200}
          />
          <div className={styles.fieldInfo}>
            <span
              className={`${styles.charCount} ${title.length >= 10 ? styles.valid : ''}`}
            >
              {title.length}/200 characters{' '}
              {title.length >= 10 ? '✓' : `(${10 - title.length} more needed)`}
            </span>
          </div>
          {errors.title && (
            <div className={styles.fieldError}>
              <span className={styles.errorIcon}>!</span>
              {errors.title}
            </div>
          )}
        </div>

        {/* Content Editor */}
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel}>
            Article Content
            <span className={styles.required}>*</span>
          </label>
          <div
            className={`${styles.editorWrapper} ${errors.text ? styles.editorError : ''}`}
          >
            <TiptapEditor text={text} handleEditorChange={handleEditorChange} />
          </div>
          <div className={styles.fieldInfo}>
            <span
              className={`${styles.charCount} ${getTextLength() >= 500 ? styles.valid : ''}`}
            >
              {getTextLength()}/10000 characters{' '}
              {getTextLength() >= 500
                ? '✓'
                : `(${500 - getTextLength()} more needed)`}
            </span>
          </div>
          {errors.text && (
            <div className={styles.fieldError}>
              <span className={styles.errorIcon}>!</span>
              {errors.text}
            </div>
          )}
        </div>

        {/* Image Upload */}
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel}>
            Featured Image
            <span className={styles.required}>*</span>
          </label>

          <CldUploadWidget
            signatureEndpoint="/api/dashboard/blog/add/sign-image"
            onSuccess={(result) => {
              setImageUrl(result?.info.public_id);
              setErrors((prev) => ({ ...prev, imageUrl: '' }));
            }}
            onProgress={(progress) => {
              setUploadProgress(progress);
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
                <div className={styles.uploadSection}>
                  <button
                    className={`${styles.uploadButton} ${!canUpload ? styles.uploadDisabled : ''} ${imageUrl ? styles.uploadSuccess : ''}`}
                    onClick={(e) => {
                      e.preventDefault();
                      if (canUpload) open();
                    }}
                    type="button"
                    disabled={!canUpload}
                  >
                    <span className={styles.uploadIcon}>
                      {imageUrl ? '✓' : '+'}
                    </span>
                    {imageUrl ? 'Change Image' : 'Upload Image'}
                  </button>

                  {!canUpload && (
                    <p className={styles.uploadHint}>
                      Complete the title first to upload an image
                    </p>
                  )}

                  {uploadProgress > 0 && uploadProgress < 100 && (
                    <div className={styles.progressBar}>
                      <div
                        className={styles.progressFill}
                        style={{ width: `${uploadProgress}%` }}
                      ></div>
                    </div>
                  )}
                </div>
              );
            }}
          </CldUploadWidget>

          {imageUrl && (
            <div className={styles.imagePreview}>
              <CldImage
                width="400"
                height="300"
                src={imageUrl}
                sizes="100vw"
                alt="Article featured image"
                className={styles.previewImage}
              />
              <button
                type="button"
                className={styles.removeImage}
                onClick={() => setImageUrl('')}
              >
                ×
              </button>
            </div>
          )}

          {errors.imageUrl && (
            <div className={styles.fieldError}>
              <span className={styles.errorIcon}>!</span>
              {errors.imageUrl}
            </div>
          )}
        </div>

        {/* Submit Button */}
        <div className={styles.submitSection}>
          <button
            type="submit"
            className={`${styles.submitButton} ${isLoading ? styles.submitLoading : ''}`}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <div className={styles.buttonSpinner}></div>
                Creating Article...
              </>
            ) : (
              <>
                <span className={styles.submitIcon}>✨</span>
                Publish Article
              </>
            )}
          </button>

          <p className={styles.submitHint}>
            Make sure all fields are completed before publishing
          </p>
        </div>
      </form>
    </section>
  );
};

export default CreatePostPage;
