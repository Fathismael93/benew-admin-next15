'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import styles from '@/ui/styling/dashboard/platforms/editPlatform.module.css';
import { MdSave, MdCancel, MdInfo, MdEdit } from 'react-icons/md';

const EditPlatform = ({ platform }) => {
  const router = useRouter();

  // États du formulaire
  const [formData, setFormData] = useState({
    platformName: '',
    platformNumber: '',
    isActive: true,
  });

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [successMessage, setSuccessMessage] = useState('');
  const [hasChanges, setHasChanges] = useState(false);

  // Initialiser le formulaire avec les données de la plateforme
  useEffect(() => {
    if (platform) {
      setFormData({
        platformName: platform.platform_name || '',
        platformNumber: platform.platform_number || '',
        isActive: platform.is_active !== undefined ? platform.is_active : true,
      });
    }
  }, [platform]);

  // Gérer les changements des inputs
  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    const newValue = type === 'checkbox' ? checked : value;

    setFormData((prev) => ({
      ...prev,
      [name]: newValue,
    }));

    setHasChanges(true);

    // Effacer l'erreur du champ modifié
    if (errors[name]) {
      setErrors((prev) => ({
        ...prev,
        [name]: '',
      }));
    }

    // Effacer le message de succès si l'utilisateur modifie après un succès
    if (successMessage) {
      setSuccessMessage('');
    }
  };

  // Valider le formulaire côté client
  const validateForm = () => {
    const newErrors = {};

    if (!formData.platformName.trim()) {
      newErrors.platformName = 'Platform name is required';
    } else if (formData.platformName.trim().length < 3) {
      newErrors.platformName = 'Platform name must be at least 3 characters';
    }

    if (!formData.platformNumber.trim()) {
      newErrors.platformNumber = 'Platform number is required';
    } else if (formData.platformNumber.trim().length < 3) {
      newErrors.platformNumber =
        'Platform number must be at least 3 characters';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Soumettre le formulaire
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setLoading(true);
    setErrors({});
    setSuccessMessage('');

    try {
      const response = await fetch(
        `/api/dashboard/platforms/${platform.platform_id}/edit`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            platformName: formData.platformName.trim(),
            platformNumber: formData.platformNumber.trim(),
            isActive: formData.isActive,
          }),
        },
      );

      // Vérifier si la réponse est ok
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.success || response.status === 200) {
        setSuccessMessage('Platform updated successfully!');
        setHasChanges(false);

        // Optionnel : rediriger après un délai
        setTimeout(() => {
          router.push('/dashboard/platforms');
        }, 2000);
      }
    } catch (error) {
      console.error('Error updating platform:', error);

      // Tenter de parser la réponse d'erreur si possible
      let errorData = null;
      try {
        if (error.response) {
          errorData = await error.response.json();
        }
      } catch (parseError) {
        // Ignorer les erreurs de parsing
      }

      if (errorData?.errors) {
        // Erreurs de validation du serveur
        setErrors(errorData.errors);
      } else if (errorData?.error) {
        // Erreur générale du serveur
        setErrors({
          general: errorData.error,
        });
      } else if (error.message?.includes('HTTP error')) {
        // Erreur HTTP
        setErrors({
          general: 'Server error. Please try again.',
        });
      } else {
        // Erreur de réseau ou autre
        setErrors({
          general: 'Failed to update platform. Please try again.',
        });
      }
    } finally {
      setLoading(false);
    }
  };

  // Annuler les modifications
  const handleCancel = () => {
    if (hasChanges) {
      if (
        confirm('You have unsaved changes. Are you sure you want to cancel?')
      ) {
        router.push('/dashboard/platforms');
      }
    } else {
      router.push('/dashboard/platforms');
    }
  };

  // Réinitialiser le formulaire
  const handleReset = () => {
    if (confirm('Are you sure you want to reset all changes?')) {
      setFormData({
        platformName: platform.platform_name || '',
        platformNumber: platform.platform_number || '',
        isActive: platform.is_active !== undefined ? platform.is_active : true,
      });
      setErrors({});
      setSuccessMessage('');
      setHasChanges(false);
    }
  };

  if (!platform) {
    return (
      <div className={styles.container}>
        <div className={styles.errorMessage}>
          <MdInfo />
          Platform not found.
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.titleSection}>
          <MdEdit className={styles.titleIcon} />
          <h1>Edit Platform</h1>
        </div>
        <div className={styles.platformInfo}>
          <span className={styles.platformId}>ID: {platform.platform_id}</span>
          <span
            className={`${styles.statusBadge} ${platform.is_active ? styles.active : styles.inactive}`}
          >
            {platform.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>

      {/* Messages de succès/erreur globaux */}
      {successMessage && (
        <div className={styles.successMessage}>{successMessage}</div>
      )}

      {errors.general && (
        <div className={styles.errorMessage}>{errors.general}</div>
      )}

      <form onSubmit={handleSubmit} className={styles.form}>
        {/* Nom de la plateforme */}
        <div className={styles.formGroup}>
          <label htmlFor="platformName" className={styles.label}>
            Platform Name *
          </label>
          <input
            type="text"
            id="platformName"
            name="platformName"
            value={formData.platformName}
            onChange={handleInputChange}
            className={`${styles.input} ${errors.platformName ? styles.inputError : ''}`}
            placeholder="Enter platform name"
            disabled={loading}
          />
          {errors.platformName && (
            <span className={styles.fieldError}>{errors.platformName}</span>
          )}
        </div>

        {/* Numéro de la plateforme */}
        <div className={styles.formGroup}>
          <label htmlFor="platformNumber" className={styles.label}>
            Platform Number *
          </label>
          <input
            type="text"
            id="platformNumber"
            name="platformNumber"
            value={formData.platformNumber}
            onChange={handleInputChange}
            className={`${styles.input} ${errors.platformNumber ? styles.inputError : ''}`}
            placeholder="Enter platform number or code"
            disabled={loading}
          />
          {errors.platformNumber && (
            <span className={styles.fieldError}>{errors.platformNumber}</span>
          )}
          <span className={styles.inputHint}>
            Can be a phone number or alphanumeric code
          </span>
        </div>

        {/* Statut actif/inactif */}
        <div className={styles.formGroup}>
          <div className={styles.checkboxGroup}>
            <input
              type="checkbox"
              id="isActive"
              name="isActive"
              checked={formData.isActive}
              onChange={handleInputChange}
              className={styles.checkbox}
              disabled={loading}
            />
            <label htmlFor="isActive" className={styles.checkboxLabel}>
              Platform is active
            </label>
          </div>
          <span className={styles.inputHint}>
            Inactive platforms will not be available for transactions
          </span>
        </div>

        {/* Informations de la plateforme */}
        <div className={styles.platformDetails}>
          <h3>Platform Information</h3>
          <div className={styles.detailsGrid}>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Created:</span>
              <span className={styles.detailValue}>
                {new Date(platform.created_at).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
            {platform.updated_at && (
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>Last Updated:</span>
                <span className={styles.detailValue}>
                  {new Date(platform.updated_at).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Boutons d'action */}
        <div className={styles.buttonGroup}>
          <button
            type="submit"
            disabled={loading || !hasChanges}
            className={`${styles.button} ${styles.saveButton}`}
          >
            <MdSave />
            {loading ? 'Saving...' : 'Save Changes'}
          </button>

          <button
            type="button"
            onClick={handleReset}
            disabled={loading || !hasChanges}
            className={`${styles.button} ${styles.resetButton}`}
          >
            Reset
          </button>

          <button
            type="button"
            onClick={handleCancel}
            disabled={loading}
            className={`${styles.button} ${styles.cancelButton}`}
          >
            <MdCancel />
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};

export default EditPlatform;
