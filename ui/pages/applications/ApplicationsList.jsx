// ui/pages/applications/ApplicationsList.js (Client Component)

'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { CldImage } from 'next-cloudinary';
import axios from 'axios';
import styles from '@/ui/styling/dashboard/applications/applicationsList.module.css';

function ApplicationsList({ applications }) {
  const router = useRouter();

  console.log(applications);

  const handleView = (id) => {
    router.push(`/dashboard/applications/${id}`);
  };

  const handleEdit = (id) => {
    router.push(`/dashboard/applications/edit/${id}`);
  };

  const handleDelete = async (id) => {
    if (confirm('Are you sure you want to delete this application?')) {
      const response = await axios.delete(
        `/api/dashboard/applications/delete?id=${id}`,
      );

      if (response.data.success) {
        router.refresh(); // Refresh the page to reflect changes
      }
    }
  };

  return (
    <div className={styles.applicationsContainer}>
      <h1>Applications List</h1>
      <div className={styles.applicationsGrid}>
        {applications !== undefined &&
          applications.map((app) => (
            <div key={app.application_id} className={styles.applicationCard}>
              <div className={styles.applicationImage}>
                <CldImage
                  width="300"
                  height="200"
                  src={app.application_images[0]} // First image in the array
                  alt={`${app.application_name} image`}
                  className={styles.image}
                />
              </div>
              <div className={styles.applicationDetails}>
                <h2>{app.application_name}</h2>
                <p>Fee: ${app.application_fee}</p>
                <p>Rent: ${app.application_rent}/month</p>
                <a
                  href={app.application_link}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Visit Application
                </a>
              </div>
              <div className={styles.applicationActions}>
                <button
                  className={styles.actionButton}
                  onClick={() => handleView(app.application_id)}
                >
                  View
                </button>
                <button
                  className={styles.actionButton}
                  onClick={() => handleEdit(app.application_id)}
                >
                  Edit
                </button>
                <button
                  className={styles.actionButton}
                  onClick={() => handleDelete(app.application_id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

export default ApplicationsList;
