'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CldImage, CldUploadWidget } from 'next-cloudinary';
import axios from 'axios';
import styles from '@/ui/styling/dashboard/applications/add/addApplication.module.css';

function AddApplication({ templates }) {
  const [name, setName] = useState('');
  const [link, setLink] = useState('');
  const [description, setDescription] = useState('');
  const [fee, setFee] = useState(0);
  const [rent, setRent] = useState(0);
  const [category, setCategory] = useState('');
  const [imageUrls, setImageUrls] = useState([]); // Changed to array
  const [type, setType] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const router = useRouter();

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!name || name.length < 3) {
      setErrorMessage('Name is missing');
      return;
    }

    if (!link || link.length < 3) {
      setErrorMessage('Link is missing');
      return;
    }

    if (!fee || fee === 0) {
      setErrorMessage('Fee is missing');
      return;
    }

    if (!rent || rent < 0) {
      setErrorMessage('Rent is missing');
      return;
    }

    if (!category) {
      setErrorMessage('Category is missing');
      return;
    }

    if (imageUrls.length === 0) {
      // Check if at least one image is uploaded
      setErrorMessage('At least one image is required');
      return;
    }

    // Then add the validation in handleSubmit
    if (!type || type.length < 2) {
      setErrorMessage('Application type is missing');
      return;
    }

    if (!templateId) {
      setErrorMessage('Please select a template');
      return;
    }

    // Update the axios post request to include the type
    const response = await axios.post(
      '/api/dashboard/applications/add',
      JSON.stringify({
        name,
        link,
        description: description || null,
        category,
        fee,
        rent,
        imageUrls,
        templateId: parseInt(templateId, 10),
        type, // Add the type field
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      },
    );

    if (await response.data.success) {
      router.push('/dashboard/applications');
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
            onChange={(e) => setName(e.target.value)}
          />
          <input
            type="number"
            name="firstTimeFee"
            min="0"
            placeholder="Prix d'ouverture du compte"
            onChange={(e) => setFee(e.target.value)}
          />
          <input
            type="text"
            name="lien"
            placeholder="Lien vers l'application"
            onChange={(e) => setLink(e.target.value)}
          />
          <input
            type="number"
            name="rent"
            placeholder="Location par mois"
            onChange={(e) => setRent(e.target.value)}
          />
          <input
            type="text"
            name="type"
            placeholder="Type d'application"
            onChange={(e) => setType(e.target.value)}
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
