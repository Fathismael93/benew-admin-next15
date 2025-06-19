'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CldImage, CldUploadWidget } from 'next-cloudinary';
import axios from 'axios';
import styles from '@/ui/styling/dashboard/applications/edit/editApplication.module.css';
import { MdArrowBack, MdInfo, MdCheck, MdClose, MdError } from 'react-icons/md';
import Link from 'next/link';
import { applicationUpdateSchema } from '@utils/schemas/applicationSchema';

function EditApplication({ application }) {
  const router = useRouter();

  // Editable fields
  const [name, setName] = useState(application.application_name);
  const [link, setLink] = useState(application.application_link);
  const [admin, setAdmin] = useState(application.application_admin_link || '');
  const [description, setDescription] = useState(
    application.application_description || '',
  );
  const [fee, setFee] = useState(application.application_fee);
  const [rent, setRent] = useState(application.application_rent);
  const [category, setCategory] = useState(application.application_category);
  const [level, setLevel] = useState(application.application_level || 1);
  const [imageUrls, setImageUrls] = useState(
    application.application_images || [],
  );
  const [otherVersions, setOtherVersions] = useState(
    Array.isArray(application.application_other_versions)
      ? application.application_other_versions?.join(', ')
      : application.application_other_versions || '',
  );
  const [isActive, setIsActive] = useState(application.is_active);

  // Read-only fields (for display only)
  const salesCount = application.sales_count || 0;
  const createdAt = application.created_at;
  const updatedAt = application.updated_at;

  const [errorMessage, setErrorMessage] = useState('');
  // État pour les erreurs par champ
  const [fieldErrors, setFieldErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Helper function to format dates
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Fonction pour vérifier si un champ a une erreur
  const hasFieldError = (fieldName) => {
    return fieldErrors[fieldName] && fieldErrors[fieldName].length > 0;
  };

  // Fonction pour obtenir l'erreur d'un champ
  const getFieldError = (fieldName) => {
    return fieldErrors[fieldName] || '';
  };

  // Méthode handleSubmit avec gestion d'erreurs par champ
  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    const formData = {
      name,
      link,
      admin,
      description,
      fee: parseFloat(fee),
      rent: parseFloat(rent),
      category,
      level: parseInt(level),
      imageUrls,
      otherVersions: otherVersions
        ? otherVersions
            .split(',')
            .map((url) => url.trim())
            .filter((url) => url)
        : null,
      isActive,
    };

    try {
      // Validation avec le schema Yup
      await applicationUpdateSchema.validate(formData, {
        abortEarly: false,
      });

      // Réinitialiser les erreurs
      setErrorMessage('');
      setFieldErrors({});

      // Envoyer la requête
      const response = await axios.put(
        `/api/dashboard/applications/${application.application_id}/edit`,
        JSON.stringify(formData),
        {
          headers: { 'Content-Type': 'application/json' },
        },
      );

      if (response.data.success) {
        router.push('/dashboard/applications');
      } else {
        setErrorMessage(
          response.data.message || 'Failed to update application.',
        );
      }
    } catch (error) {
      if (error.name === 'ValidationError') {
        // Créer un objet d'erreurs par champ
        const errors = {};
        error.inner.forEach((err) => {
          errors[err.path] = err.message;
        });

        setFieldErrors(errors);
        setErrorMessage(
          'Please fix the validation errors below and try again.',
        );

        console.warn('Validation errors:', error.errors);
        console.warn(
          'Failed fields:',
          error.inner.map((err) => ({
            field: err.path,
            message: err.message,
          })),
        );
      } else if (error.response) {
        // Erreur de l'API
        setErrorMessage(
          error.response.data.message ||
            'An error occurred while updating the application.',
        );
        console.error('API error:', error.response.data);
      } else if (error.request) {
        // Erreur réseau
        setErrorMessage(
          'Network error. Please check your connection and try again.',
        );
        console.error('Network error:', error.request);
      } else {
        // Autre erreur
        setErrorMessage('An unexpected error occurred. Please try again.');
        console.error('Update error:', error);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className={`${styles.editApplicationContainer} ${isActive ? styles.activeContainer : styles.inactiveContainer}`}
    >
      <Link href="/dashboard/applications" className={styles.backButton}>
        <MdArrowBack /> Back to Applications
      </Link>

      <div className={styles.header}>
        <h1>Edit Application</h1>
        <div
          className={`${styles.statusIndicator} ${isActive ? styles.active : styles.inactive}`}
        >
          {isActive ? (
            <>
              <MdCheck className={styles.statusIcon} />
              <span>Active Application</span>
            </>
          ) : (
            <>
              <MdClose className={styles.statusIcon} />
              <span>Inactive Application</span>
            </>
          )}
        </div>
      </div>

      {/* Read-only information section */}
      <div className={styles.readOnlySection}>
        <h3>
          <MdInfo className={styles.infoIcon} />
          Application Information
        </h3>
        <div className={styles.readOnlyGrid}>
          <div className={styles.readOnlyItem}>
            <strong>Sales Count:</strong>
            <span className={styles.salesCount}>{salesCount} sales</span>
          </div>
          <div className={styles.readOnlyItem}>
            <strong>Created:</strong>
            <span className={styles.dateValue}>{formatDate(createdAt)}</span>
          </div>
          <div className={styles.readOnlyItem}>
            <strong>Last Updated:</strong>
            <span className={styles.dateValue}>{formatDate(updatedAt)}</span>
          </div>
        </div>
      </div>

      <form className={styles.editApplicationForm} onSubmit={handleSubmit}>
        {errorMessage && <p className={styles.errorMessage}>{errorMessage}</p>}

        <div className={styles.inputs}>
          {/* Application Name */}
          <div className={styles.inputGroup}>
            <input
              type="text"
              name="name"
              placeholder="Application Name *"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={hasFieldError('name') ? styles.inputError : ''}
              required
            />
            {hasFieldError('name') && (
              <div className={styles.fieldError}>
                <MdError className={styles.errorIcon} />
                <span>{getFieldError('name')}</span>
              </div>
            )}
          </div>

          {/* Application Link */}
          <div className={styles.inputGroup}>
            <input
              type="url"
              name="link"
              placeholder="Application Link *"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              className={hasFieldError('link') ? styles.inputError : ''}
              required
            />
            {hasFieldError('link') && (
              <div className={styles.fieldError}>
                <MdError className={styles.errorIcon} />
                <span>{getFieldError('link')}</span>
              </div>
            )}
          </div>

          {/* Admin Link */}
          <div className={styles.inputGroup}>
            <input
              type="url"
              name="admin"
              placeholder="Admin Link (Optional)"
              value={admin}
              onChange={(e) => setAdmin(e.target.value)}
              className={hasFieldError('admin') ? styles.inputError : ''}
            />
            {hasFieldError('admin') && (
              <div className={styles.fieldError}>
                <MdError className={styles.errorIcon} />
                <span>{getFieldError('admin')}</span>
              </div>
            )}
          </div>

          {/* Application Fee */}
          <div className={styles.inputGroup}>
            <input
              type="number"
              name="fee"
              placeholder="Application Fee *"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              className={hasFieldError('fee') ? styles.inputError : ''}
              min="0"
              step="0.01"
              required
            />
            {hasFieldError('fee') && (
              <div className={styles.fieldError}>
                <MdError className={styles.errorIcon} />
                <span>{getFieldError('fee')}</span>
              </div>
            )}
          </div>

          {/* Application Rent */}
          <div className={styles.inputGroup}>
            <input
              type="number"
              name="rent"
              placeholder="Application Rent *"
              value={rent}
              onChange={(e) => setRent(e.target.value)}
              className={hasFieldError('rent') ? styles.inputError : ''}
              min="0"
              step="0.01"
              required
            />
            {hasFieldError('rent') && (
              <div className={styles.fieldError}>
                <MdError className={styles.errorIcon} />
                <span>{getFieldError('rent')}</span>
              </div>
            )}
          </div>

          {/* Application Level */}
          <div className={styles.inputGroup}>
            <select
              name="level"
              value={level}
              onChange={(e) => setLevel(parseInt(e.target.value))}
              className={`${styles.levelSelect} ${hasFieldError('level') ? styles.inputError : ''}`}
              required
            >
              <option value="">Select Level *</option>
              <option value={1}>1 - Basic</option>
              <option value={2}>2 - Intermediate</option>
              <option value={3}>3 - Advanced</option>
              <option value={4}>4 - Professional</option>
            </select>
            {hasFieldError('level') && (
              <div className={styles.fieldError}>
                <MdError className={styles.errorIcon} />
                <span>{getFieldError('level')}</span>
              </div>
            )}
          </div>

          {/* Other Versions */}
          <div className={styles.inputGroup}>
            <input
              type="text"
              name="otherVersions"
              placeholder="Other Versions (comma-separated)"
              value={otherVersions}
              onChange={(e) => setOtherVersions(e.target.value)}
              className={
                hasFieldError('otherVersions') ? styles.inputError : ''
              }
            />
            {hasFieldError('otherVersions') && (
              <div className={styles.fieldError}>
                <MdError className={styles.errorIcon} />
                <span>{getFieldError('otherVersions')}</span>
              </div>
            )}
          </div>
        </div>

        {/* Description */}
        <div className={styles.inputGroup}>
          <textarea
            name="description"
            className={`${styles.description} ${hasFieldError('description') ? styles.inputError : ''}`}
            placeholder="Application Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows="5"
          />
          {hasFieldError('description') && (
            <div className={styles.fieldError}>
              <MdError className={styles.errorIcon} />
              <span>{getFieldError('description')}</span>
            </div>
          )}
        </div>

        <div className={styles.controlsSection}>
          {/* Category Radio Buttons */}
          <div className={styles.radioButtons}>
            <h4>Category *</h4>
            <div
              className={
                hasFieldError('category') ? styles.radioGroupError : ''
              }
            >
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="category"
                  value="web"
                  checked={category === 'web'}
                  onChange={(e) => setCategory(e.target.value)}
                  required
                />
                <span>Web Application</span>
              </label>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="category"
                  value="mobile"
                  checked={category === 'mobile'}
                  onChange={(e) => setCategory(e.target.value)}
                  required
                />
                <span>Mobile Application</span>
              </label>
            </div>
            {hasFieldError('category') && (
              <div className={styles.fieldError}>
                <MdError className={styles.errorIcon} />
                <span>{getFieldError('category')}</span>
              </div>
            )}
          </div>

          {/* Active Toggle */}
          <div className={styles.activeToggle}>
            <h4>Application Status</h4>
            <div
              className={
                hasFieldError('isActive') ? styles.checkboxGroupError : ''
              }
            >
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className={styles.activeCheckbox}
                />
                <span
                  className={`${styles.checkboxText} ${isActive ? styles.activeText : styles.inactiveText}`}
                >
                  {isActive
                    ? 'Application is Active'
                    : 'Application is Inactive'}
                </span>
              </label>
            </div>
            {hasFieldError('isActive') && (
              <div className={styles.fieldError}>
                <MdError className={styles.errorIcon} />
                <span>{getFieldError('isActive')}</span>
              </div>
            )}
          </div>
        </div>

        {/* Image Section */}
        <div className={styles.imageSection}>
          <h4>Application Images *</h4>
          <CldUploadWidget
            signatureEndpoint="/api/dashboard/applications/add/sign-image"
            onSuccess={(result) => {
              setImageUrls((prev) => [...prev, result?.info?.public_id]);
              console.log('Image saved successfully in cloudinary');
            }}
            options={{
              folder: 'applications',
              multiple: true,
            }}
          >
            {({ open }) => {
              function handleOnClick(e) {
                e.preventDefault();
                open();
              }
              return (
                <button
                  className={styles.addImage}
                  onClick={handleOnClick}
                  type="button"
                  disabled={isSubmitting}
                >
                  Add Image
                </button>
              );
            }}
          </CldUploadWidget>

          <div className={styles.images}>
            {imageUrls.map((url, index) => (
              <div key={index} className={styles.imageContainer}>
                <CldImage
                  width="200"
                  height="150"
                  src={url}
                  alt={`Application image ${index + 1}`}
                  className={styles.image}
                />
                <button
                  type="button"
                  className={styles.removeImage}
                  onClick={() =>
                    setImageUrls((prev) => prev.filter((_, i) => i !== index))
                  }
                  disabled={isSubmitting}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          {imageUrls.length === 0 && (
            <p className={styles.imageWarning}>
              At least one image is required
            </p>
          )}

          {hasFieldError('imageUrls') && (
            <div className={styles.fieldError}>
              <MdError className={styles.errorIcon} />
              <span>{getFieldError('imageUrls')}</span>
            </div>
          )}
        </div>

        <button
          type="submit"
          className={styles.saveButton}
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Saving Changes...' : 'Save Changes'}
        </button>
      </form>
    </div>
  );
}

export default EditApplication;
