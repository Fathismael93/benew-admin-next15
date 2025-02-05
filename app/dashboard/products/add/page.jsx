'use client';

import { React, useState } from 'react';
import { CldImage, CldUploadWidget } from 'next-cloudinary';
import axios from 'axios';
import { redirect } from 'next/navigation';
import styles from '@/ui/styling/dashboard/products/add/addProduct.module.css';

function NewProduct() {
  const [name, setName] = useState('');
  const [link, setLink] = useState('');
  const [description, setDescription] = useState('');
  const [fee, setFee] = useState(0);
  const [rent, setRent] = useState(0);
  const [category, setCategory] = useState('');
  const [imageUrl, setImageUrl] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');

  const images = [];

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

    if (!description || description.length < 3) {
      setErrorMessage('Description is missing');
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

    if (!imageUrl || imageUrl.length === 0) {
      setErrorMessage('Image is missing');
      return;
    }

    const response = await axios.post(
      '/api/dashboard/products/add',
      JSON.stringify({
        name,
        link,
        description,
        category,
        fee,
        rent,
        imageUrl,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      },
    );

    if (await response.data.success) {
      redirect('/dashboard/products');
    }
  };

  return (
    <section className={styles.createPostContainer}>
      <div className={styles.createPostTitle}>
        <h2>Add new product</h2>
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
        </div>
        <textarea
          name="description"
          id="description"
          placeholder="Décrivez l'application..."
          cols="30"
          rows="7"
          onChange={(e) => setDescription(e.target.value)}
        />
        <div
          className={styles.radioButtons}
          onChange={(e) => setCategory(e.target.value)}
        >
          <div className={styles.categorie}>
            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
            <label htmlFor="website">Site Web</label>
            <input
              type="radio"
              name="categorie"
              value="site web"
              id="website"
            />
          </div>
          <div className={styles.categorie}>
            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
            <label htmlFor="mobile">Mobile App</label>
            <input
              type="radio"
              name="categorie"
              value="mobile app"
              id="mobile"
            />
          </div>
        </div>
        <CldUploadWidget
          signatureEndpoint="/api/dashboard/products/add/sign-image"
          onSuccess={(result) => {
            images.push(result?.info?.public_id);
          }}
          onClose={() => {
            setImageUrl(images);
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
          {imageUrl.length > 0 &&
            imageUrl.map((url) => {
              return (
                <div key={url} className={styles.postDetailImage}>
                  <CldImage
                    width="350"
                    height="300"
                    src={url}
                    sizes="100vw"
                    alt="Image illustration of the article"
                  />
                </div>
              );
            })}
        </div>
        <button type="submit" className={styles.addButton}>
          Ajouter
        </button>
      </form>
    </section>
  );
}

export default NewProduct;
