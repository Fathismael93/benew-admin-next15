'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CldImage, CldUploadWidget } from 'next-cloudinary';
import styles from '@/ui/styling/dashboard/applications/add/addApplication.module.css';
import { applicationAddingSchema } from '@/utils/schemas/applicationSchema';

function AddApplication({ templates }) {
  const [name, setName] = useState('');
  const [link, setLink] = useState('');
  const [admin, setAdmin] = useState('');
  const [description, setDescription] = useState('');
  const [fee, setFee] = useState(0);
  const [rent, setRent] = useState(0);
  const [category, setCategory] = useState('');
  const [imageUrls, setImageUrls] = useState([]);
  const [level, setLevel] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');
    setIsLoading(true);

    // Vérifications de base pour les champs requis
    if (!name || name.length < 3) {
      setErrorMessage(
        "Le nom de l'application est requis et doit contenir au moins 3 caractères",
      );
      setIsLoading(false);
      return;
    }

    if (!link || link.length < 3) {
      setErrorMessage(
        "Le lien de l'application est requis et doit contenir au moins 3 caractères",
      );
      setIsLoading(false);
      return;
    }

    if (!admin || admin.length < 3) {
      setErrorMessage(
        'Le lien admin est requis et doit contenir au moins 3 caractères',
      );
      setIsLoading(false);
      return;
    }

    if (!fee || fee === 0) {
      setErrorMessage(
        "Le prix d'ouverture est requis et doit être supérieur à 0",
      );
      setIsLoading(false);
      return;
    }

    if (rent < 0) {
      setErrorMessage('La location mensuelle ne peut pas être négative');
      setIsLoading(false);
      return;
    }

    if (!category) {
      setErrorMessage('La catégorie est requise (Web ou Mobile)');
      setIsLoading(false);
      return;
    }

    if (imageUrls.length === 0) {
      setErrorMessage('Au moins une image est requise');
      setIsLoading(false);
      return;
    }

    if (!level || level < 1 || level > 4) {
      setErrorMessage("Le niveau de l'application doit être entre 1 et 4");
      setIsLoading(false);
      return;
    }

    if (!templateId) {
      setErrorMessage('Veuillez sélectionner un template');
      setIsLoading(false);
      return;
    }

    // Vérifier la compatibilité template/catégorie
    const selectedTemplate = templates.find(
      (t) => t.template_id.toString() === templateId,
    );

    if (selectedTemplate) {
      if (category === 'web' && !selectedTemplate.template_has_web) {
        setErrorMessage(
          'Le template sélectionné ne supporte pas les applications Web',
        );
        setIsLoading(false);
        return;
      }
      if (category === 'mobile' && !selectedTemplate.template_has_mobile) {
        setErrorMessage(
          'Le template sélectionné ne supporte pas les applications Mobile',
        );
        setIsLoading(false);
        return;
      }
    }

    // Préparer les données pour la validation
    const formData = {
      name,
      link,
      admin,
      description: description || null,
      fee: parseInt(fee, 10),
      rent: parseInt(rent, 10),
      category,
      imageUrls,
      level: parseInt(level, 10),
      templateId,
    };

    try {
      // Validation avec applicationAddingSchema
      await applicationAddingSchema.validate(formData, { abortEarly: false });

      // Si validation réussie, procéder à l'envoi
      const response = await fetch('/api/dashboard/applications/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      // Vérifier si la réponse est ok
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.success) {
        router.push('/dashboard/applications');
      }
    } catch (validationError) {
      if (validationError.name === 'ValidationError') {
        // Erreurs de validation Yup - afficher la première erreur
        const firstError = validationError.errors[0];
        setErrorMessage(firstError || 'Échec de la validation');
      } else if (validationError.message?.includes('HTTP error')) {
        // Erreurs HTTP
        setErrorMessage('Erreur serveur. Veuillez réessayer.');
      } else {
        // Autres erreurs (réseau, etc.)
        setErrorMessage(
          validationError.message ||
            "Une erreur s'est produite lors de l'ajout de l'application",
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveImage = (indexToRemove) => {
    setImageUrls((prev) => prev.filter((_, index) => index !== indexToRemove));
  };

  const selectedTemplate = templates.find(
    (t) => t.template_id.toString() === templateId,
  );

  return (
    <section className={styles.createPostContainer}>
      <div className={styles.createPostTitle}>
        <h2>Ajouter une nouvelle application</h2>
      </div>

      <form className={styles.createPostForm} onSubmit={handleSubmit}>
        {errorMessage && <p className={styles.errorMessage}>{errorMessage}</p>}

        <div className={styles.inputs}>
          <div className={styles.inputGroup}>
            <label htmlFor="name" className={styles.label}>
              Nom de l&apos;application *
            </label>
            <input
              type="text"
              id="name"
              name="name"
              placeholder="Ex: Instagram, WhatsApp, Netflix..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={styles.input}
            />
          </div>

          <div className={styles.inputGroup}>
            <label htmlFor="fee" className={styles.label}>
              Prix d&apos;ouverture du compte (€) *
            </label>
            <input
              type="number"
              id="fee"
              name="fee"
              min="0"
              step="0.01"
              placeholder="Ex: 25.00"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              className={styles.input}
            />
          </div>

          <div className={styles.inputGroup}>
            <label htmlFor="link" className={styles.label}>
              Lien vers l&apos;application *
            </label>
            <input
              type="url"
              id="link"
              name="link"
              placeholder="https://example.com/app"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              className={styles.input}
            />
          </div>

          <div className={styles.inputGroup}>
            <label htmlFor="admin" className={styles.label}>
              Lien administration *
            </label>
            <input
              type="url"
              id="admin"
              name="admin"
              placeholder="https://admin.example.com"
              value={admin}
              onChange={(e) => setAdmin(e.target.value)}
              className={styles.input}
            />
          </div>

          <div className={styles.inputGroup}>
            <label htmlFor="rent" className={styles.label}>
              Location mensuelle (€)
            </label>
            <input
              type="number"
              id="rent"
              name="rent"
              min="0"
              step="0.01"
              placeholder="Ex: 5.00 (optionnel)"
              value={rent}
              onChange={(e) => setRent(e.target.value)}
              className={styles.input}
            />
          </div>

          <div className={styles.inputGroup}>
            <label htmlFor="level" className={styles.label}>
              Niveau d&apos;application (1-4) *
            </label>
            <select
              id="level"
              name="level"
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              className={styles.input}
            >
              <option value="">Sélectionnez un niveau</option>
              <option value="1">Niveau 1 - Basique</option>
              <option value="2">Niveau 2 - Intermédiaire</option>
              <option value="3">Niveau 3 - Avancé</option>
              <option value="4">Niveau 4 - Expert</option>
            </select>
          </div>

          <div className={styles.inputGroup}>
            <label htmlFor="templateId" className={styles.label}>
              Template *
            </label>
            <select
              id="templateId"
              className={styles.input}
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value="">Sélectionnez un template</option>
              {templates.map((template) => (
                <option key={template.template_id} value={template.template_id}>
                  {template.template_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {selectedTemplate && (
          <div className={styles.templateInfo}>
            <div className={styles.templatePreviewContainer}>
              <CldImage
                width="200"
                height="150"
                src={selectedTemplate.template_image}
                sizes="100vw"
                alt={`Template ${selectedTemplate.template_name}`}
                className={styles.templatePreview}
              />
              <div className={styles.templateDetails}>
                <h4>{selectedTemplate.template_name}</h4>
                <p>Disponible pour:</p>
                <div className={styles.platformSupport}>
                  {selectedTemplate.template_has_web && (
                    <span className={styles.platformBadge}>Web</span>
                  )}
                  {selectedTemplate.template_has_mobile && (
                    <span className={styles.platformBadge}>Mobile</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className={styles.inputGroup}>
          <label htmlFor="description" className={styles.label}>
            Description (optionnel)
          </label>
          <textarea
            id="description"
            name="description"
            placeholder="Décrivez les fonctionnalités principales de l'application..."
            cols="30"
            rows="4"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={styles.textarea}
          />
        </div>

        <div className={styles.inputGroup}>
          <label className={styles.label}>Catégorie *</label>
          <div className={styles.radioButtons}>
            <div className={styles.radioOption}>
              <input
                type="radio"
                id="website"
                name="categorie"
                value="web"
                checked={category === 'web'}
                onChange={(e) => setCategory(e.target.value)}
                disabled={
                  selectedTemplate && !selectedTemplate.template_has_web
                }
                className={styles.radioInput}
              />
              <label htmlFor="website" className={styles.radioLabel}>
                Site Web
              </label>
            </div>
            <div className={styles.radioOption}>
              <input
                type="radio"
                id="mobile"
                name="categorie"
                value="mobile"
                checked={category === 'mobile'}
                onChange={(e) => setCategory(e.target.value)}
                disabled={
                  selectedTemplate && !selectedTemplate.template_has_mobile
                }
                className={styles.radioInput}
              />
              <label htmlFor="mobile" className={styles.radioLabel}>
                Application Mobile
              </label>
            </div>
          </div>
        </div>

        <div className={styles.inputGroup}>
          <label className={styles.label}>Images de l&apos;application *</label>
          <CldUploadWidget
            signatureEndpoint="/api/dashboard/applications/add/sign-image"
            onSuccess={(result) => {
              setImageUrls((prev) => [...prev, result?.info?.public_id]);
            }}
            options={{
              folder: 'applications',
              multiple: true,
              sources: ['local', 'url'],
              clientAllowedFormats: ['jpg', 'jpeg', 'png', 'webp'],
              maxImageFileSize: 5000000, // 5MB
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
                  {imageUrls.length === 0
                    ? 'Ajouter des images'
                    : 'Ajouter une autre image'}
                </button>
              );
            }}
          </CldUploadWidget>
          <p className={styles.uploadHint}>
            Formats acceptés: JPG, PNG, WebP (max 5MB par image)
          </p>
        </div>

        {imageUrls.length > 0 && (
          <div className={styles.imageGallery}>
            <h4 className={styles.galleryTitle}>
              Images ajoutées ({imageUrls.length})
            </h4>
            <div className={styles.images}>
              {imageUrls.map((url, index) => (
                <div key={index} className={styles.postDetailImage}>
                  <CldImage
                    width="350"
                    height="300"
                    src={url}
                    sizes="100vw"
                    alt={`Illustration de l'application ${index + 1}`}
                  />
                  <button
                    type="button"
                    className={styles.removeImage}
                    onClick={() => handleRemoveImage(index)}
                    title="Supprimer cette image"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          type="submit"
          className={`${styles.addButton} ${isLoading ? styles.loading : ''}`}
          disabled={isLoading}
        >
          {isLoading ? 'Ajout en cours...' : "Ajouter l'application"}
        </button>
      </form>
    </section>
  );
}

export default AddApplication;
