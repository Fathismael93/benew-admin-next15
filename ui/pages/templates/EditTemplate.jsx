'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CldUploadWidget, CldImage } from 'next-cloudinary';
import styles from '@/ui/styling/dashboard/templates/editTemplate/editTemplate.module.css';
import { templateUpdateSchema } from '@/utils/schemas/templateSchema';

const EditTemplate = ({ template }) => {
  const [templateName, setTemplateName] = useState(template.template_name);
  const [hasWeb, setHasWeb] = useState(template.template_has_web);
  const [hasMobile, setHasMobile] = useState(template.template_has_mobile);
  const [isActive, setIsActive] = useState(template.is_active);
  const [publicId, setPublicId] = useState(template.template_image);
  const [templateColor, setTemplateColor] = useState(
    template.template_color || '#3b82f6',
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [validationErrors, setValidationErrors] = useState({});
  const router = useRouter();

  // Synchroniser avec les changements de template.template_color
  useEffect(() => {
    setTemplateColor(template.template_color || '#3b82f6');
  }, [template.template_color]);

  const handleUploadSuccess = (result) => {
    const uploadInfo = result.info;
    setPublicId(uploadInfo.public_id);
    setSuccess('Image updated successfully!');
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

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setValidationErrors({});

    // Préparer les données pour la validation
    const formData = {
      templateName,
      templateImageId: publicId,
      templateHasWeb: hasWeb,
      templateHasMobile: hasMobile,
      templateColor,
      isActive: isActive,
    };

    try {
      // Validation avec templateUpdateSchema
      await templateUpdateSchema.validate(formData, { abortEarly: false });

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
            templateColor,
            isActive: isActive,
            oldImageId: template.template_image,
          }),
        },
      );

      if (!response.ok) {
        const errorData = await response.json();

        // Gestion des erreurs de validation côté serveur
        if (errorData.errors && typeof errorData.errors === 'object') {
          setValidationErrors(errorData.errors);
          setError('Please correct the errors below');
          return;
        }

        throw new Error(errorData.message || 'Failed to update template');
      }

      await response.json();

      setSuccess('Template updated successfully!');

      // Redirection optimisée avec revalidation
      setTimeout(() => {
        router.push('/dashboard/templates');
        router.refresh(); // Force la revalidation des données côté serveur
      }, 1500);
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
      <h1 className={styles.title}>Edit Template</h1>

      {/* Informations du template */}
      <div className={styles.templateInfo}>
        <h3 className={styles.infoTitle}>Template Information</h3>
        <div className={styles.infoGrid}>
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>Template ID:</span>
            <span className={styles.infoValue}>{template.template_id}</span>
          </div>
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>Sales Count:</span>
            <span className={styles.salesCount}>{template.sales_count}</span>
          </div>
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>Created:</span>
            <span className={styles.infoValue}>
              {formatDate(template.template_added)}
            </span>
          </div>
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>Last Updated:</span>
            <span className={styles.infoValue}>
              {formatDate(template.updated_at)}
            </span>
          </div>
        </div>
      </div>

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

        <div className={styles.formGroup}>
          <label htmlFor="templateColor">Template Color</label>
          <div className={styles.colorPickerContainer}>
            <div
              className={styles.colorPreview}
              style={{ backgroundColor: templateColor }}
            >
              <span className={styles.colorValue}>{templateColor}</span>
            </div>
            <input
              type="color"
              id="templateColor"
              value={templateColor}
              onChange={(e) => {
                setTemplateColor(e.target.value);
                clearFieldError('templateColor');
              }}
              className={`${styles.colorPicker} ${validationErrors.templateColor ? styles.inputError : ''}`}
            />
            <button
              type="button"
              className={styles.colorResetButton}
              onClick={() =>
                setTemplateColor(template.template_color || '#3b82f6')
              }
              title="Reset to original color"
            >
              Reset
            </button>
          </div>
          {validationErrors.templateColor && (
            <div className={styles.fieldError}>
              {validationErrors.templateColor}
            </div>
          )}
        </div>

        <div className={styles.statusSection}>
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

            <div className={`${styles.checkbox} ${styles.statusCheckbox}`}>
              <input
                type="checkbox"
                id="isActive"
                checked={isActive}
                onChange={(e) => {
                  setIsActive(e.target.checked);
                  clearFieldError('isActive');
                }}
                className={styles.statusInput}
              />
              <label
                htmlFor="isActive"
                className={`${styles.statusLabel} ${isActive ? styles.activeLabel : styles.inactiveLabel}`}
              >
                <span
                  className={`${styles.statusIndicator} ${isActive ? styles.activeIndicator : styles.inactiveIndicator}`}
                ></span>
                {isActive ? 'Active' : 'Inactive'}
              </label>
            </div>

            {validationErrors.isActive && (
              <div className={styles.fieldError}>
                {validationErrors.isActive}
              </div>
            )}
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
                className={`${styles.uploadButton} ${validationErrors.templateImageId ? styles.uploadButtonError : ''}`}
                onClick={() => open()}
              >
                Update Template Image
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
          {isLoading ? 'Updating...' : 'Update Template'}
        </button>
      </form>
    </div>
  );
};

export default EditTemplate;
