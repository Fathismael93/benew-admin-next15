'use client';

import React, { useState } from 'react';
import axios from 'axios';
import { redirect } from 'next/navigation';
import styles from '@/ui/styling/dashboard/presentation/add-presentation/add.module.css';
import { presentationSchema } from '@/utils/schemas';

function AddPresentation() {
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      await presentationSchema.validate(
        {
          name,
          title,
          text,
        },
        { abortEarly: false },
      );

      await axios
        .post(
          '/api/dashboard/presentation/add',
          JSON.stringify({ name, title, text }),
          {
            headers: { 'Content-Type': 'application/json' },
          },
        )
        .then((response) => {
          setIsSuccess(response.data.success);
        })
        .catch((error) => {
          setErrorMessage(error.message);
        });
    } catch (error) {
      setErrorMessage(error.inner[0].message);
    }
  };

  if (isSuccess) {
    redirect('/dashboard/presentation/');
  }

  return (
    <section className={styles.createPostContainer}>
      <div className={styles.createPostTitle}>
        <h2>Create Presentation</h2>
      </div>
      <form className={styles.createPostForm} onSubmit={(e) => handleSubmit(e)}>
        {errorMessage && <p className={styles.errorMessage}>{errorMessage}</p>}
        <input
          type="text"
          name="name"
          placeholder="Nom de présentation"
          onChange={(e) => setName(e.target.value)}
        />
        <input
          type="text"
          name="title"
          placeholder="Titre présentation"
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          name="presentation"
          id="presentation"
          placeholder="Ecrivez votre présentation ici..."
          cols="30"
          rows="20"
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className={styles.addButton}>
          Create
        </button>
      </form>
    </section>
  );
}

export default AddPresentation;
