'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CldImage, CldUploadWidget } from 'next-cloudinary';
import axios from 'axios';
import styles from '@/ui/styling/dashboard/applications/edit/editApplication.module.css';
import { MdArrowBack, MdInfo, MdCheck, MdClose } from 'react-icons/md';
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
  // État pour les erreurs par champ (à ajouter dans le useState)
  const [fieldErrors, setFieldErrors] = useState({});

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

  // Version alternative avec gestion d'erreurs par champ
  const handleSubmitWithFieldErrors = async (e) => {
    e.preventDefault();

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
        stripUnknown: true, // Supprime les champs non définis
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
        setErrorMessage('Please fix the errors below and try again.');
      } else {
        // Autres erreurs
        setErrorMessage('An error occurred while updating the application.');
        console.error('Update error:', error);
      }
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

      <form
        className={styles.editApplicationForm}
        onSubmit={handleSubmitWithFieldErrors}
      >
        {errorMessage && <p className={styles.errorMessage}>{errorMessage}</p>}

        <div className={styles.inputs}>
          <input
            type="text"
            name="name"
            placeholder="Application Name *"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            type="url"
            name="link"
            placeholder="Application Link *"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            required
          />
          <input
            type="url"
            name="admin"
            placeholder="Admin Link (Optional)"
            value={admin}
            onChange={(e) => setAdmin(e.target.value)}
          />
          <input
            type="number"
            name="fee"
            placeholder="Application Fee *"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            min="0"
            step="0.01"
            required
          />
          <input
            type="number"
            name="rent"
            placeholder="Application Rent *"
            value={rent}
            onChange={(e) => setRent(e.target.value)}
            min="0"
            step="0.01"
            required
          />
          <select
            name="level"
            value={level}
            onChange={(e) => setLevel(parseInt(e.target.value))}
            className={styles.levelSelect}
            required
          >
            <option value="">Select Level *</option>
            <option value={1}>1 - Basic</option>
            <option value={2}>2 - Intermediate</option>
            <option value={3}>3 - Advanced</option>
            <option value={4}>4 - Professional</option>
          </select>
          <input
            type="text"
            name="otherVersions"
            placeholder="Other Versions (comma-separated)"
            value={otherVersions}
            onChange={(e) => setOtherVersions(e.target.value)}
          />
        </div>

        <textarea
          name="description"
          className={styles.description}
          placeholder="Application Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows="5"
        />

        <div className={styles.controlsSection}>
          <div className={styles.radioButtons}>
            <h4>Category *</h4>
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

          <div className={styles.activeToggle}>
            <h4>Application Status</h4>
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
                {isActive ? 'Application is Active' : 'Application is Inactive'}
              </span>
            </label>
          </div>
        </div>

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
        </div>

        <button type="submit" className={styles.saveButton}>
          Save Changes
        </button>
      </form>
    </div>
  );
}

export default EditApplication;
