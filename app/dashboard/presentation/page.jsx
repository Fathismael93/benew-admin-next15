'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { MdAdd } from 'react-icons/md';
import axios from 'axios';
import { redirect } from 'next/navigation';
import styles from '@/ui/styling/dashboard/presentation/presentation.module.css';
import Search from '@/ui/components/dashboard/search';
import PresCard from '@/ui/components/dashboard/PresCard';
import { deletePresentationSchema } from '@/utils/schemas';

function Presentation() {
  const [presentations, setPresentations] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    async function getPresentations() {
      await axios
        .get('/api/dashboard/presentation')
        .then((response) => setPresentations(response.data.data.rows))
        .catch((error) => setErrorMessage(error.message));
    }

    getPresentations();
  }, []);

  // eslint-disable-next-line camelcase
  const deletePresentation = async (presentation_id) => {
    try {
      // eslint-disable-next-line camelcase
      await deletePresentationSchema.validate({ presentation_id });

      await axios
        // eslint-disable-next-line camelcase
        .delete(`/api/dashboard/presentation/${presentation_id}/delete`)
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
    <div className={styles.container}>
      <div className={styles.top}>
        <Search placeholder="Search for a presentation..." />
        <Link href="/dashboard/presentation/add">
          <button className={styles.addButton} type="button">
            <MdAdd /> Nouveau
          </button>
        </Link>
      </div>
      <div className={styles.presentationsContainer}>
        {errorMessage && <p className={styles.errorMessage}>{errorMessage}</p>}
        {presentations.length > 0 ? (
          presentations.map(
            // eslint-disable-next-line camelcase
            ({ presentation_id, presentation_title, presentation_text }) => {
              return (
                <PresCard
                  // eslint-disable-next-line camelcase
                  key={presentation_id}
                  // eslint-disable-next-line camelcase
                  pres_id={presentation_id}
                  // eslint-disable-next-line camelcase
                  title={presentation_title}
                  // eslint-disable-next-line camelcase
                  text={presentation_text}
                  deletePresentation={deletePresentation}
                />
              );
            },
          )
        ) : (
          <div>
            <h2>Aucun contenu !</h2>
          </div>
        )}
      </div>
    </div>
  );
}

export default Presentation;
