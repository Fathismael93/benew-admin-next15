'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CldUploadWidget } from 'next-cloudinary';
import { CldImage } from 'next-cloudinary';
import styles from '@/ui/styling/dashboard/templates/addTemplate/addTemplate.module.css';

const AddTemplatePage = () => {
  const [templateName, setTemplateName] = useState('');
  const [hasWeb, setHasWeb] = useState(true);
  const [hasMobile, setHasMobile] = useState(false);
  const [publicId, setPublicId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const router = useRouter();

  const handleUploadSuccess = (result) => {
    const uploadInfo = result.info;
    setPublicId(uploadInfo.public_id);
    setSuccess('Image uploaded successfully!');
    setTimeout(() => setSuccess(''), 3000);
  };

  const handleUploadError = (error) => {
    setError('Failed to upload image. Please try again.');
    console.error('Upload error:', error);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!templateName.trim()) {
      setError('Template name is required');
      return;
    }

    if (!publicId) {
      setError('Please upload an image for the template');
      return;
    }

    try {
      setIsLoading(true);

      const response = await fetch('/api/templates/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          templateName,
          templateImageId: publicId,
          templateHasWeb: hasWeb,
          templateHasMobile: hasMobile,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to add template');
      }

      setSuccess('Template added successfully!');

      // Reset form
      setTemplateName('');
      setHasWeb(true);
      setHasMobile(false);
      setPublicId('');

      // Redirect to templates list after successful addition
      setTimeout(() => {
        router.push('/admin/templates');
      }, 2000);
    } catch (err) {
      setError(err.message || 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Add New Template</h1>

      <form className={styles.form} onSubmit={handleSubmit}>
        {error && <div className={styles.error}>{error}</div>}
        {success && <div className={styles.success}>{success}</div>}

        <div className={styles.formGroup}>
          <label htmlFor="templateName">Template Name</label>
          <input
            type="text"
            id="templateName"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder="Enter template name"
            className={styles.input}
            required
          />
        </div>

        <div className={styles.checkboxGroup}>
          <div className={styles.checkbox}>
            <input
              type="checkbox"
              id="hasWeb"
              checked={hasWeb}
              onChange={(e) => setHasWeb(e.target.checked)}
            />
            <label htmlFor="hasWeb">Web</label>
          </div>

          <div className={styles.checkbox}>
            <input
              type="checkbox"
              id="hasMobile"
              checked={hasMobile}
              onChange={(e) => setHasMobile(e.target.checked)}
            />
            <label htmlFor="hasMobile">Mobile</label>
          </div>
        </div>

        <div className={styles.imageUpload}>
          <CldUploadWidget
            uploadPreset={process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET}
            options={{
              sources: ['local', 'url', 'camera'],
              multiple: false,
              cropping: true,
              folder: 'templates',
              clientAllowedFormats: ['jpg', 'jpeg', 'png', 'webp'],
              maxImageFileSize: 5000000, // 5MB
            }}
            signatureEndpoint="/api/dashboard/templates/add/sign-image"
            onSuccess={handleUploadSuccess}
            onError={handleUploadError}
          >
            {({ open }) => (
              <button
                type="button"
                className={styles.uploadButton}
                onClick={() => open()}
              >
                Upload Template Image
              </button>
            )}
          </CldUploadWidget>

          {publicId && (
            <div className={styles.imagePreview}>
              <CldImage
                width="300"
                height="200"
                src={publicId}
                alt="Template Preview"
                crop="fill"
                gravity="auto"
                sizes="(max-width: 768px) 100vw, 300px"
              />
            </div>
          )}
        </div>

        <button
          type="submit"
          className={styles.submitButton}
          disabled={isLoading}
        >
          {isLoading ? 'Adding...' : 'Add Template'}
        </button>
      </form>
    </div>
  );
};

export default AddTemplatePage;
