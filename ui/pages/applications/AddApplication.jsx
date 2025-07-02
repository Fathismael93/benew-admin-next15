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
  const [imageUrls, setImageUrls] = useState([]); // Changed to array
  const [level, setLevel] = useState(''); // Changed from type to level
  const [templateId, setTemplateId] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const router = useRouter();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');

    // Vérifications de base pour les champs requis
    if (!name || name.length < 3) {
      setErrorMessage(
        'Application name is required and must be at least 3 characters',
      );
      return;
    }

    if (!link || link.length < 3) {
      setErrorMessage(
        'Application link is required and must be at least 3 characters',
      );
      return;
    }

    if (!admin || admin.length < 3) {
      setErrorMessage(
        'Admin link is required and must be at least 3 characters',
      );
      return;
    }

    if (!fee || fee === 0) {
      setErrorMessage('Opening fee is required and must be greater than 0');
      return;
    }

    if (rent < 0) {
      setErrorMessage('Monthly rent cannot be negative');
      return;
    }

    if (!category) {
      setErrorMessage('Category is required (Web or Mobile)');
      return;
    }

    if (imageUrls.length === 0) {
      setErrorMessage('At least one image is required');
      return;
    }

    if (!level || level < 1 || level > 4) {
      setErrorMessage('Application level must be between 1 and 4');
      return;
    }

    if (!templateId) {
      setErrorMessage('Please select a template');
      return;
    }

    // Vérifier la compatibilité template/catégorie
    const selectedTemplate = templates.find(
      (t) => t.template_id.toString() === templateId,
    );

    if (selectedTemplate) {
      if (category === 'web' && !selectedTemplate.template_has_web) {
        setErrorMessage('Selected template does not support Web applications');
        return;
      }
      if (category === 'mobile' && !selectedTemplate.template_has_mobile) {
        setErrorMessage(
          'Selected template does not support Mobile applications',
        );
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
        setErrorMessage(firstError || 'Validation failed');
      } else if (validationError.message?.includes('HTTP error')) {
        // Erreurs HTTP
        setErrorMessage('Server error. Please try again.');
      } else {
        // Autres erreurs (réseau, etc.)
        setErrorMessage(
          validationError.message ||
            'An error occurred while adding the application',
        );
      }
    }
  };

  const selectedTemplate = templates.find(
    (t) => t.template_id.toString() === templateId,
  );

  return (
    <section className={styles.createPostContainer}>
      <div className={styles.createPostTitle}>
        <h2>Add new application</h2>
      </div>
      <form className={styles.createPostForm} onSubmit={(e) => handleSubmit(e)}>
        {errorMessage && <p className={styles.errorMessage}>{errorMessage}</p>}
        <div className={styles.inputs}>
          <input
            type="text"
            name="name"
            placeholder="Nom de l'application"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            type="number"
            name="firstTimeFee"
            min="0"
            placeholder="Prix d'ouverture du compte"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
          />
          <input
            type="text"
            name="lien"
            placeholder="Lien vers l'application"
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
          <input
            type="text"
            name="admin"
            placeholder="Lien admin"
            value={admin}
            onChange={(e) => setAdmin(e.target.value)}
          />
          <input
            type="number"
            name="rent"
            placeholder="Location par mois"
            value={rent}
            onChange={(e) => setRent(e.target.value)}
          />
          <input
            type="number"
            name="level"
            min="1"
            max="4"
            placeholder="Niveau d'application (1-4)"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
          />
          <select
            className={styles.templateSelect}
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

        {selectedTemplate && (
          <div className={styles.templateInfo}>
            <CldImage
              width="200"
              height="150"
              src={selectedTemplate.template_image}
              sizes="100vw"
              alt={`Template ${selectedTemplate.template_name}`}
              className={styles.templatePreview}
            />
            <div className={styles.templateDetails}>
              <p>Available for:</p>
              {selectedTemplate.template_has_web && <span>Web</span>}
              {selectedTemplate.template_has_mobile && <span>Mobile</span>}
            </div>
          </div>
        )}

        <textarea
          name="description"
          id="description"
          placeholder="Décrivez l'application... (optionnel)"
          cols="30"
          rows="7"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div
          className={styles.radioButtons}
          onChange={(e) => setCategory(e.target.value)}
        >
          <div className={styles.categorie}>
            <label htmlFor="website">Site Web</label>
            <input
              type="radio"
              name="categorie"
              value="web"
              id="website"
              checked={category === 'web'}
              disabled={selectedTemplate && !selectedTemplate.template_has_web}
            />
          </div>
          <div className={styles.categorie}>
            <label htmlFor="mobile">Mobile App</label>
            <input
              type="radio"
              name="categorie"
              value="mobile"
              id="mobile"
              checked={category === 'mobile'}
              disabled={
                selectedTemplate && !selectedTemplate.template_has_mobile
              }
            />
          </div>
        </div>
        <CldUploadWidget
          signatureEndpoint="/api/dashboard/applications/add/sign-image"
          onSuccess={(result) => {
            setImageUrls((prev) => [...prev, result?.info?.public_id]); // Add new image URL to array
          }}
          options={{
            folder: 'applications',
            multiple: true, // Allow multiple uploads
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
        {imageUrls.length > 0 && (
          <div className={styles.images}>
            {imageUrls.map((url, index) => (
              <div key={index} className={styles.postDetailImage}>
                <CldImage
                  width="350"
                  height="300"
                  src={url}
                  sizes="100vw"
                  alt={`Application illustration ${index + 1}`}
                />
              </div>
            ))}
          </div>
        )}
        <button type="submit" className={styles.addButton}>
          Ajouter
        </button>
      </form>
    </section>
  );
}

export default AddApplication;
