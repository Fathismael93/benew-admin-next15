'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CldUploadWidget, CldImage } from 'next-cloudinary';
import styles from '@/ui/styling/dashboard/templates/editTemplate/editTemplate.module.css';

const EditTemplate = ({ template }) => {
  const [templateName, setTemplateName] = useState(template.template_name);
  const [hasWeb, setHasWeb] = useState(template.template_has_web);
  const [hasMobile, setHasMobile] = useState(template.template_has_mobile);
  const [publicId, setPublicId] = useState(template.template_image);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const router = useRouter();

  const handleUploadSuccess = (result) => {
    const uploadInfo = result.info;
    setPublicId(uploadInfo.public_id);
    setSuccess('Image updated successfully!');
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

      const response = await fetch(
        `/api/dashboard/templates/${template.template_id}/edit`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            templateName,
            templateImageId: publicId,
            templateHasWeb: hasWeb,
            templateHasMobile: hasMobile,
            oldImageId: template.template_image,
          }),
        },
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to update template');
      }

      setSuccess('Template updated successfully!');

      // Redirect to templates list after successful update
      setTimeout(() => {
        router.push('/dashboard/templates');
      }, 2000);
    } catch (err) {
      setError(err.message || 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Edit Template</h1>

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
            options={{
              sources: ['local', 'url', 'camera'],
              multiple: false,
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
                Update Template Image
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
          {isLoading ? 'Updating...' : 'Update Template'}
        </button>
      </form>
    </div>
  );
};

export default EditTemplate;
