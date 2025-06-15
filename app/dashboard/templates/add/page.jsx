'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CldUploadWidget } from 'next-cloudinary';
import { CldImage } from 'next-cloudinary';
import styles from '@/ui/styling/dashboard/templates/addTemplate/addTemplate.module.css';
import { sanitizeTemplateInputs } from '@/utils/sanitizers/sanitizeTemplateInputs';
import { templateAddingSchema } from '@/utils/schemas/templateSchema';

const AddTemplatePage = () => {
  const [templateName, setTemplateName] = useState('');
  const [hasWeb, setHasWeb] = useState(true);
  const [hasMobile, setHasMobile] = useState(false);
  const [publicId, setPublicId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [validationErrors, setValidationErrors] = useState({});
  const router = useRouter();

  const handleUploadSuccess = (result) => {
    const uploadInfo = result.info;
    setPublicId(uploadInfo.public_id);
    setSuccess('Image uploaded successfully!');
    setTimeout(() => setSuccess(''), 3000);

    // Clear validation error for image if it exists
    if (validationErrors.templateImageId) {
      setValidationErrors((prev) => ({
        ...prev,
        templateImageId: '',
      }));
    }
  };

  const handleUploadError = (error) => {
    setError('Failed to upload image. Please try again.');
    console.error('Upload error:', error);
  };

  const clearFieldError = (fieldName) => {
    if (validationErrors[fieldName]) {
      setValidationErrors((prev) => ({
        ...prev,
        [fieldName]: '',
      }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setValidationErrors({});

    // Préparer les données du formulaire
    const formData = {
      templateName,
      templateImageId: publicId,
      templateHasWeb: hasWeb,
      templateHasMobile: hasMobile,
    };

    try {
      // 1. Sanitization des inputs (version de base, pas stricte)
      const sanitizedData = sanitizeTemplateInputs(formData);

      // 2. Validation avec Yup
      await templateAddingSchema.validate(sanitizedData, { abortEarly: false });

      // 3. Si validation réussie, procéder à l'envoi
      setIsLoading(true);

      const response = await fetch('/api/dashboard/templates/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sanitizedData),
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
      setValidationErrors({});

      // Redirect to templates list after successful addition
      setTimeout(() => {
        router.push('/dashboard/templates');
      }, 2000);
    } catch (validationError) {
      if (validationError.name === 'ValidationError') {
        // Erreurs de validation Yup
        const newErrors = {};
        validationError.inner.forEach((error) => {
          newErrors[error.path] = error.message;
        });
        setValidationErrors(newErrors);
        setError('Please correct the errors below');
      } else {
        // Autres erreurs (API, réseau, etc.)
        setError(validationError.message || 'An error occurred');
      }
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
            onChange={(e) => {
              setTemplateName(e.target.value);
              clearFieldError('templateName');
            }}
            placeholder="Enter template name"
            className={`${styles.input} ${validationErrors.templateName ? styles.inputError : ''}`}
            required
          />
          {validationErrors.templateName && (
            <div className={styles.fieldError}>
              {validationErrors.templateName}
            </div>
          )}
        </div>

        <div className={styles.checkboxGroup}>
          <div className={styles.checkbox}>
            <input
              type="checkbox"
              id="hasWeb"
              checked={hasWeb}
              onChange={(e) => {
                setHasWeb(e.target.checked);
                // Clear platform validation error when user changes selection
                if (
                  validationErrors.templateHasWeb ||
                  validationErrors.templateHasMobile
                ) {
                  setValidationErrors((prev) => ({
                    ...prev,
                    templateHasWeb: '',
                    templateHasMobile: '',
                  }));
                }
              }}
            />
            <label htmlFor="hasWeb">Web</label>
          </div>

          <div className={styles.checkbox}>
            <input
              type="checkbox"
              id="hasMobile"
              checked={hasMobile}
              onChange={(e) => {
                setHasMobile(e.target.checked);
                // Clear platform validation error when user changes selection
                if (
                  validationErrors.templateHasWeb ||
                  validationErrors.templateHasMobile
                ) {
                  setValidationErrors((prev) => ({
                    ...prev,
                    templateHasWeb: '',
                    templateHasMobile: '',
                  }));
                }
              }}
            />
            <label htmlFor="hasMobile">Mobile</label>
          </div>

          {/* Validation error for platform selection */}
          {(validationErrors.templateHasWeb ||
            validationErrors.templateHasMobile) && (
            <div className={styles.fieldError}>
              Template must be available for at least one platform (Web or
              Mobile)
            </div>
          )}
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
                className={`${styles.uploadButton} ${validationErrors.templateImageId ? styles.uploadButtonError : ''}`}
                onClick={() => open()}
              >
                Upload Template Image
              </button>
            )}
          </CldUploadWidget>

          {validationErrors.templateImageId && (
            <div className={styles.fieldError}>
              {validationErrors.templateImageId}
            </div>
          )}

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
