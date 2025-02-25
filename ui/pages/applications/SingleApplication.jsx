'use client';

import React, { useEffect, useState } from 'react';
import { CldImage } from 'next-cloudinary';
import styles from '@/ui/styling/dashboard/applications/singleApplication.module.css';
import Link from 'next/link';
import { MdArrowBack } from 'react-icons/md';
import axios from 'axios';
import { useRouter } from 'next/navigation';

function SingleApplication({ data }) {
  const [application, setApplication] = useState(data);
  const router = useRouter();

  useEffect(() => {
    setApplication(data);
  }, [data]);

  if (!application) {
    return <div>Application not found</div>;
  }

  const handleDelete = async () => {
    if (confirm('Are you sure you want to delete this application?')) {
      const response = await axios.delete(
        '/api/dashboard/applications/delete',
        {
          data: {
            id: application.application_id,
            application_images: application.application_images,
          },
        },
      );

      if (response.data.success) {
        router.push('/dashboard/applications'); // Redirect to applications list page
      }
    }
  };

  return (
    <div className={styles.singleApplicationContainer}>
      <Link href="/dashboard/applications" className={styles.backButton}>
        <MdArrowBack /> Back to Applications
      </Link>
      <h1>{application.application_name}</h1>
      <div className={styles.applicationDetails}>
        <div className={styles.applicationImages}>
          {application.application_images.map((image, index) => (
            <div key={index} className={styles.imageContainer}>
              <CldImage
                width="400"
                height="300"
                src={image}
                alt={`${application.application_name} image ${index + 1}`}
                className={styles.image}
              />
            </div>
          ))}
        </div>
        <div className={styles.applicationInfo}>
          <p className={styles.applicationType}>
            <strong>Type:</strong> {application.application_type}
          </p>
          <p>
            <strong>Link:</strong>{' '}
            <a
              href={application.application_link}
              target="_blank"
              rel="noopener noreferrer"
            >
              {application.application_link}
            </a>
          </p>
          <p>
            <strong>Description:</strong> {application.application_description}
          </p>
          <p>
            <strong>Category:</strong> {application.application_category}
          </p>
          <p>
            <strong>Fee:</strong> {application.application_fee}
          </p>
          <p>
            <strong>Rent:</strong> {application.application_rent}
          </p>
          {application.application_other_versions && (
            <p>
              <strong>Other Versions:</strong>
              <ul>
                {application.application_other_versions.map((url, index) => (
                  <li key={index}>
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            </p>
          )}
        </div>
      </div>
      <div className={styles.applicationActions}>
        <Link
          href={`/dashboard/applications/${application.application_id}/edit`}
          className={`${styles.actionLink} ${styles.editLink}`}
        >
          Edit
        </Link>
        <button
          className={`${styles.actionButton} ${styles.deleteButton}`}
          onClick={handleDelete}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

export default SingleApplication;
