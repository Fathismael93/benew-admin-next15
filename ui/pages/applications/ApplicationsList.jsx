'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { CldImage } from 'next-cloudinary';
import axios from 'axios';
import styles from '@/ui/styling/dashboard/applications/applicationsList.module.css';
import Search from '@/ui/components/dashboard/search';
import Link from 'next/link';
import { MdAdd } from 'react-icons/md';

function ApplicationsList({ applications }) {
  const router = useRouter();

  console.log(applications);

  const handleDelete = async (id, application_images) => {
    if (confirm('Are you sure you want to delete this application?')) {
      const response = await axios.delete(
        '/api/dashboard/applications/delete',
        {
          data: { id, application_images }, // Send id and application_images in the body
        },
      );

      if (response.data.success) {
        router.refresh(); // Refresh the page to reflect changes
      }
    }
  };

  return (
    <div className={styles.applicationsContainer}>
      <div className={styles.top}>
        <Search placeholder="Search for an application..." />
        <Link href="/dashboard/applications/add">
          <button className={styles.addButton} type="button">
            <MdAdd /> Add Application
          </button>
        </Link>
      </div>
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
                <Link
                  href={`/dashboard/applications/${app.application_id}`}
                  className={`${styles.actionLink} ${styles.viewLink}`}
                >
                  View
                </Link>
                <Link
                  href={`/dashboard/applications/edit/${app.application_id}`}
                  className={`${styles.actionLink} ${styles.editLink}`}
                >
                  Edit
                </Link>
                <button
                  className={`${styles.actionButton} ${styles.deleteButton}`}
                  onClick={() =>
                    handleDelete(app.application_id, app.application_images)
                  }
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
