'use client';

import { useEffect, useState } from 'react';
import { CldImage } from 'next-cloudinary';
import styles from '@/ui/styling/dashboard/applications/singleApplication.module.css';
import Link from 'next/link';
import { MdArrowBack, MdCheck, MdClose } from 'react-icons/md';
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

  // Format date helper function
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className={styles.singleApplicationContainer}>
      <Link href="/dashboard/applications" className={styles.backButton}>
        <MdArrowBack /> Back to Applications
      </Link>
      <h1>{application.application_name}</h1>

      {/* Status indicator */}
      <div
        className={`${styles.statusIndicator} ${application.is_active ? styles.active : styles.inactive}`}
      >
        {application.is_active ? (
          <>
            <MdCheck className={styles.statusIcon} />
            <span>Active Application</span>
          </>
        ) : (
          <>
            <MdClose className={styles.statusIcon} />
            <span>Inactive Application</span>
          </>
        )}
      </div>

      <div className={styles.applicationDetails}>
        <div className={styles.applicationImages}>
          {Array.isArray(application.application_images) &&
            application.application_images.map((image, index) => (
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
            <strong>Type:</strong> {application.application_level}
          </p>

          <p>
            <strong>Public Link:</strong>{' '}
            <a
              href={application.application_link}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.link}
            >
              {application.application_link}
            </a>
          </p>

          {application.application_admin_link && (
            <p>
              <strong>Admin Link:</strong>{' '}
              <a
                href={application.application_admin_link}
                target="_blank"
                rel="noopener noreferrer"
                className={`${styles.link} ${styles.adminLink}`}
              >
                {application.application_admin_link}
              </a>
            </p>
          )}

          <p>
            <strong>Description:</strong>{' '}
            {application.application_description || 'No description available'}
          </p>

          <p>
            <strong>Category:</strong>{' '}
            {application.application_category || 'General'}
          </p>

          <p>
            <strong>Fee:</strong> {application.application_fee || 'Free'}
          </p>

          <p>
            <strong>Rent:</strong> {application.application_rent || 'N/A'}
          </p>

          {/* New fields */}
          <div className={styles.statsContainer}>
            <div className={styles.statItem}>
              <strong>Sales Count:</strong>
              <span className={styles.salesCount}>
                {application.sales_count || 0} sales
              </span>
            </div>

            <div className={styles.statItem}>
              <strong>Status:</strong>
              <span
                className={`${styles.statusBadge} ${application.is_active ? styles.activeBadge : styles.inactiveBadge}`}
              >
                {application.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>

          <div className={styles.dateContainer}>
            <p>
              <strong>Created:</strong>
              <span className={styles.dateValue}>
                {formatDate(application.created_at)}
              </span>
            </p>

            <p>
              <strong>Last Updated:</strong>
              <span className={styles.dateValue}>
                {formatDate(application.updated_at)}
              </span>
            </p>
          </div>

          {application.application_other_versions && (
            <div className={styles.versionsContainer}>
              <p>
                <strong>Other Versions:</strong>
              </p>
              <ul className={styles.versionsList}>
                {Array.isArray(application.application_other_versions) ? (
                  application.application_other_versions.map((url, index) => (
                    <li key={index}>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.versionLink}
                      >
                        Version {index + 1}
                      </a>
                    </li>
                  ))
                ) : (
                  <li className={styles.singleVersion}>
                    {application.application_other_versions}
                  </li>
                )}
              </ul>
            </div>
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
          className={`${styles.actionButton} ${styles.deleteButton} ${
            application.is_active ? styles.disabled : ''
          }`}
          onClick={() => !application.is_active && handleDelete()}
          disabled={application.is_active}
          title={
            application.is_active
              ? 'Cannot delete active application. Please deactivate first.'
              : 'Delete application'
          }
        >
          Delete
        </button>
      </div>
    </div>
  );
}

export default SingleApplication;
