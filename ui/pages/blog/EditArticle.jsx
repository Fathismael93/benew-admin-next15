'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CldUploadWidget, CldImage } from 'next-cloudinary';
import styles from '@/ui/styling/dashboard/blog/edit/edit.module.css';
import TiptapEditor from '@/ui/components/dashboard/editor';
import { updateArticleSchema } from '@utils/schemas/articleSchema';

const EditArticle = ({ data }) => {
  const [formData, setFormData] = useState({
    title: data?.article_title || '',
    text: data?.article_text || '',
    imageUrl: data?.article_image || '',
    isActive: data?.is_active ?? true,
  });

  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [originalData, setOriginalData] = useState({});

  const router = useRouter();

  // Sauvegarder les données originales pour détecter les changements
  useEffect(() => {
    setOriginalData({
      title: data?.article_title || '',
      text: data?.article_text || '',
      imageUrl: data?.article_image || '',
      isActive: data?.is_active ?? true,
    });
  }, [data]);

  // Détecter les changements non sauvegardés
  useEffect(() => {
    const hasChanges = Object.keys(formData).some(
      (key) => formData[key] !== originalData[key],
    );
    setHasUnsavedChanges(hasChanges);
  }, [formData, originalData]);

  // Prévenir la navigation si des changements non sauvegardés
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Gestion des changements de champs
  const handleInputChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));

    // Effacer l'erreur du champ modifié
    if (errors[field]) {
      setErrors((prev) => ({
        ...prev,
        [field]: '',
      }));
    }
  };

  const handleEditorChange = (newContent) => {
    handleInputChange('text', newContent);
  };

  // Validation en temps réel
  const validateField = async (field, value) => {
    try {
      await updateArticleSchema.validateAt(field, { [field]: value });
      setErrors((prev) => ({ ...prev, [field]: '' }));
      return true;
    } catch (error) {
      setErrors((prev) => ({ ...prev, [field]: error.message }));
      return false;
    }
  };

  // Calcul du temps de lecture estimé
  const calculateReadingTime = (text) => {
    if (!text) return 0;
    const wordsPerMinute = 200;
    const plainText = text.replace(/<[^>]*>/g, '');
    const wordCount = plainText
      .split(/\s+/)
      .filter((word) => word.length > 0).length;
    return Math.ceil(wordCount / wordsPerMinute);
  };

  // Soumission du formulaire
  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setErrors({});

    try {
      // Validation complète
      await updateArticleSchema.validate(formData, { abortEarly: false });

      // Préparer les données modifiées uniquement
      const changedData = {};
      Object.keys(formData).forEach((key) => {
        if (formData[key] !== originalData[key]) {
          changedData[key] = formData[key];
        }
      });

      if (Object.keys(changedData).length === 0) {
        setErrors({ general: 'Aucune modification détectée.' });
        setIsLoading(false);
        return;
      }

      const response = await fetch(
        `/api/dashboard/blog/${data.article_id}/edit`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(changedData),
        },
      );

      // Vérifier si la réponse est ok
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const responseData = await response.json();

      if (responseData.success) {
        setIsSuccess(true);
        setHasUnsavedChanges(false);

        // Rediriger après un délai pour montrer le succès
        setTimeout(() => {
          router.push('/dashboard/blog/');
        }, 2000);
      }
    } catch (error) {
      if (error.inner) {
        // Erreurs de validation Yup
        const validationErrors = {};
        error.inner.forEach((err) => {
          validationErrors[err.path] = err.message;
        });
        setErrors(validationErrors);
      } else if (error.message?.includes('HTTP error')) {
        // Erreurs HTTP
        setErrors({ general: 'Erreur serveur. Veuillez réessayer.' });
      } else {
        setErrors({ general: "Une erreur inattendue s'est produite." });
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Réinitialiser le formulaire
  const handleReset = () => {
    setFormData(originalData);
    setErrors({});
    setHasUnsavedChanges(false);
  };

  // Sauvegarder en brouillon
  const saveDraft = async () => {
    try {
      setIsLoading(true);
      const draftData = { ...formData, isActive: false };

      const response = await fetch(
        `/api/dashboard/blog/${data.article_id}/edit`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(draftData),
        },
      );

      // Vérifier si la réponse est ok
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const responseData = await response.json();

      if (responseData.success) {
        setFormData(draftData);
        setOriginalData(draftData);
        setHasUnsavedChanges(false);
      }
    } catch (error) {
      if (error.message?.includes('HTTP error')) {
        setErrors({
          general: 'Erreur serveur lors de la sauvegarde du brouillon.',
        });
      } else {
        setErrors({ general: 'Erreur lors de la sauvegarde du brouillon.' });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const readingTime = calculateReadingTime(formData.text);

  if (isSuccess) {
    return (
      <div className={styles.successContainer}>
        <div className={styles.successContent}>
          <div className={styles.successIcon}>✅</div>
          <h2>Article mis à jour avec succès !</h2>
          <p>Redirection en cours...</p>
          <div className={styles.successSpinner}></div>
        </div>
      </div>
    );
  }

  return (
    <section className={styles.editPostContainer}>
      {/* Header avec statut */}
      <div className={styles.editPostHeader}>
        <div className={styles.headerLeft}>
          <h2>Modifier l&apos;article</h2>
          <div className={styles.articleMeta}>
            <span className={styles.articleId}>ID: {data?.article_id}</span>
            <span className={styles.readingTime}>
              📖 {readingTime} min de lecture
            </span>
            {hasUnsavedChanges && (
              <span className={styles.unsavedIndicator}>
                ● Modifications non sauvegardées
              </span>
            )}
          </div>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            onClick={() => setShowPreview(!showPreview)}
            className={`${styles.actionButton} ${styles.previewButton}`}
          >
            {showPreview ? '✏️ Éditer' : '👁️ Aperçu'}
          </button>
          <button
            type="button"
            onClick={saveDraft}
            disabled={isLoading || !hasUnsavedChanges}
            className={`${styles.actionButton} ${styles.draftButton}`}
          >
            💾 Brouillon
          </button>
        </div>
      </div>

      {/* Status Banner */}
      <div
        className={`${styles.statusBanner} ${formData.isActive ? styles.statusActive : styles.statusInactive}`}
      >
        <div className={styles.statusInfo}>
          <span className={styles.statusIndicator}>
            {formData.isActive ? '🟢' : '🔴'}
          </span>
          <span className={styles.statusText}>
            {formData.isActive ? 'Article publié' : 'Article en brouillon'}
          </span>
        </div>
      </div>

      <form className={styles.editPostForm} onSubmit={handleSubmit}>
        {/* Messages d'erreur globaux */}
        {errors.general && (
          <div className={styles.errorMessage}>⚠️ {errors.general}</div>
        )}

        {/* Titre */}
        <div className={styles.formGroup}>
          <label htmlFor="title" className={styles.formLabel}>
            Titre de l&apos;article *
            <span className={styles.charCount}>
              {formData.title.length}/200
            </span>
          </label>
          <input
            id="title"
            type="text"
            name="title"
            placeholder="Saisissez le titre de l'article..."
            value={formData.title}
            onChange={(e) => handleInputChange('title', e.target.value)}
            onBlur={(e) => validateField('title', e.target.value)}
            className={`${styles.formInput} ${errors.title ? styles.inputError : ''}`}
            maxLength={200}
          />
          {errors.title && (
            <span className={styles.fieldError}>{errors.title}</span>
          )}
        </div>

        {/* Statut de publication */}
        <div className={styles.formGroup}>
          <div className={styles.checkboxContainer}>
            <input
              id="isActive"
              type="checkbox"
              checked={formData.isActive}
              onChange={(e) => handleInputChange('isActive', e.target.checked)}
              className={styles.checkbox}
            />
            <label htmlFor="isActive" className={styles.checkboxLabel}>
              <span className={styles.checkboxCustom}>
                {formData.isActive && '✓'}
              </span>
              Publier l&apos;article immédiatement
            </label>
          </div>
          <p className={styles.checkboxHint}>
            {formData.isActive
              ? "✅ L'article sera visible publiquement"
              : "📝 L'article sera sauvegardé en brouillon"}
          </p>
        </div>

        {/* Éditeur de contenu */}
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>
            Contenu de l&apos;article *
            <span className={styles.wordCount}>
              {
                formData.text
                  .replace(/<[^>]*>/g, '')
                  .split(/\s+/)
                  .filter((w) => w.length > 0).length
              }{' '}
              mots
            </span>
          </label>
          <div className={styles.editorContainer}>
            <TiptapEditor
              text={formData.text}
              handleEditorChange={handleEditorChange}
            />
          </div>
          {errors.text && (
            <span className={styles.fieldError}>{errors.text}</span>
          )}
        </div>

        {/* Upload d'image */}
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>Image d&apos;illustration</label>
          <div className={styles.imageUploadSection}>
            <CldUploadWidget
              signatureEndpoint="/api/dashboard/blog/add/sign-image"
              onSuccess={(result) => {
                handleInputChange('imageUrl', result?.info.public_id);
                setUploadProgress(0);
              }}
              onUpload={(result) => {
                setUploadProgress(result.progress || 0);
              }}
              options={{
                folder: 'blog_pictures',
                multiple: false,
                maxFileSize: 10000000, // 10MB
                allowedFormats: ['jpg', 'jpeg', 'png', 'webp'],
              }}
            >
              {({ open }) => {
                function handleOnClick(e) {
                  e.preventDefault();
                  if (formData.title.length > 10) {
                    open();
                  }
                }
                return (
                  <button
                    className={`${styles.uploadButton} ${formData.title.length <= 10 ? styles.uploadDisabled : ''}`}
                    onClick={handleOnClick}
                    type="button"
                    disabled={formData.title.length <= 10}
                  >
                    📷{' '}
                    {formData.imageUrl
                      ? "Changer l'image"
                      : 'Ajouter une image'}
                  </button>
                );
              }}
            </CldUploadWidget>

            {formData.title.length <= 10 && (
              <p className={styles.uploadHint}>
                ⚠️ Veuillez d&apos;abord saisir un titre de plus de 10
                caractères
              </p>
            )}

            {uploadProgress > 0 && uploadProgress < 100 && (
              <div className={styles.uploadProgress}>
                <div
                  className={styles.uploadProgressBar}
                  style={{ width: `${uploadProgress}%` }}
                ></div>
                <span>{uploadProgress}%</span>
              </div>
            )}
          </div>

          {/* Prévisualisation de l'image */}
          {formData.imageUrl && (
            <div className={styles.imagePreview}>
              <CldImage
                width="400"
                height="300"
                src={formData.imageUrl}
                alt="Aperçu de l'image d'illustration"
                className={styles.previewImage}
              />
              <button
                type="button"
                onClick={() => handleInputChange('imageUrl', '')}
                className={styles.removeImageButton}
              >
                🗑️ Supprimer l&apos;image
              </button>
            </div>
          )}

          {errors.imageUrl && (
            <span className={styles.fieldError}>{errors.imageUrl}</span>
          )}
        </div>

        {/* Actions du formulaire */}
        <div className={styles.formActions}>
          <div className={styles.formActionsLeft}>
            <button
              type="button"
              onClick={handleReset}
              disabled={isLoading || !hasUnsavedChanges}
              className={`${styles.actionButton} ${styles.resetButton}`}
            >
              ↺ Annuler les modifications
            </button>
          </div>

          <div className={styles.formActionsRight}>
            <button
              type="button"
              onClick={() =>
                router.push(`/dashboard/blog/${data.article_id}/view`)
              }
              className={`${styles.actionButton} ${styles.viewButton}`}
            >
              👁️ Voir l&apos;article
            </button>

            <button
              type="submit"
              disabled={isLoading || !hasUnsavedChanges}
              className={`${styles.actionButton} ${styles.submitButton} ${
                formData.isActive
                  ? styles.publishButton
                  : styles.draftSaveButton
              }`}
            >
              {isLoading ? (
                <span className={styles.loadingSpinner}></span>
              ) : (
                <>{formData.isActive ? '🚀 Publier' : '💾 Sauvegarder'}</>
              )}
            </button>
          </div>
        </div>

        {/* Informations sur les modifications */}
        {hasUnsavedChanges && (
          <div className={styles.changesInfo}>
            <p>📝 Vous avez des modifications non sauvegardées</p>
            <small>
              Dernière modification: {new Date().toLocaleString('fr-FR')}
            </small>
          </div>
        )}
      </form>
    </section>
  );
};

export default EditArticle;
