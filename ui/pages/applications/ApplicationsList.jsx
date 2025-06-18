'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CldImage } from 'next-cloudinary';
import axios from 'axios';
import styles from '@/ui/styling/dashboard/applications/applicationsList.module.css';
import Search from '@/ui/components/dashboard/search';
import Link from 'next/link';
import { MdAdd } from 'react-icons/md';

function ApplicationsList({ data }) {
  console.log("What's the problem !");
  const [applications, setApplications] = useState(data);
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteId, setDeleteId] = useState(null);

  useEffect(() => {
    setApplications(data);
  }, [deleteId, isDeleting]);

  console.log('Applications: ');
  console.log(applications);

  const handleDelete = async (id, application_images) => {
    if (confirm('Are you sure you want to delete this application?')) {
      setDeleteId(id);
      setIsDeleting(true);
      const response = await axios.delete(
        `/api/dashboard/applications/${id}/delete`,
        {
          data: { id, application_images }, // Send id and application_images in the body
        },
      );

      if (response.data.success) {
        setIsDeleting(false);
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
            <div
              key={app.application_id}
              className={`${styles.applicationCard} ${
                app.is_active ? styles.activeCard : styles.inactiveCard
              }`}
            >
              {/* Indicateur de statut */}
              <div
                className={`${styles.statusIndicator} ${
                  app.is_active
                    ? styles.activeIndicator
                    : styles.inactiveIndicator
                }`}
              >
                <span className={styles.statusDot}></span>
                <span className={styles.statusText}>
                  {app.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>

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
                <p className={styles.applicationType}>
                  Type: {app.application_level}
                </p>
                <p>Fee: {app.application_fee} Fdj</p>
                <p>Rent: {app.application_rent} Fdj/month</p>
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
                  href={`/dashboard/applications/${app.application_id}/edit`}
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
