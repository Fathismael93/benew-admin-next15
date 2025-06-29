'use client';

import { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CldImage } from 'next-cloudinary';
import axios from 'axios';
import styles from '@/ui/styling/dashboard/applications/applicationsList.module.css';
import AppFilters from '@ui/components/dashboard/AppFilters';
import Link from 'next/link';
import { MdAdd, MdMonitor, MdPhoneIphone } from 'react-icons/md';
import AppSearch from '@ui/components/dashboard/search/AppSearch';
import { getFilteredApplications } from '@app/dashboard/applications/actions';

function ApplicationsList({ data }) {
  const [applications, setApplications] = useState(data);
  const [isPending, startTransition] = useTransition();
  const [currentFilters, setCurrentFilters] = useState({});
  const [error, setError] = useState(null);
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteId, setDeleteId] = useState(null);

  useEffect(() => {
    setApplications(data);
  }, [data, deleteId, isDeleting]);

  // Fonction pour gérer les filtres avec gestion d'erreur améliorée
  const handleFilterChange = (newFilters) => {
    setCurrentFilters(newFilters);
    setError(null); // Reset l'erreur

    startTransition(async () => {
      try {
        const filteredData = await getFilteredApplications(newFilters);
        setApplications(filteredData);
      } catch (error) {
        console.error('Filter error:', error);
        setError('Failed to filter applications. Please try again.');
        // Garder les données actuelles en cas d'erreur
      }
    });
  };

  // Fonction pour effacer tous les filtres
  const clearAllFilters = () => {
    setCurrentFilters({});
    setError(null);

    startTransition(async () => {
      try {
        const allData = await getFilteredApplications({});
        setApplications(allData);
      } catch (error) {
        console.error('Clear filters error:', error);
        setError('Failed to clear filters. Please refresh the page.');
      }
    });
  };

  const handleDelete = async (id, application_images) => {
    if (confirm('Are you sure you want to delete this application?')) {
      setDeleteId(id);
      setIsDeleting(true);

      try {
        const response = await axios.delete(
          `/api/dashboard/applications/${id}/delete`,
          {
            data: { id, application_images },
          },
        );

        if (response.data.success) {
          setIsDeleting(false);
          router.push('/dashboard/applications');
        }
      } catch (error) {
        console.error('Delete error:', error);
        setIsDeleting(false);
        setError('Failed to delete application. Please try again.');
      }
    }
  };

  // Vérifier si on a des filtres actifs
  const hasActiveFilters = Object.keys(currentFilters).length > 0;

  return (
    <div className={styles.applicationsContainer}>
      <div className={styles.top}>
        <AppSearch
          placeholder="Search for an application..."
          onFilterChange={handleFilterChange}
          currentFilters={currentFilters}
        />
        <AppFilters
          onFilterChange={handleFilterChange}
          currentFilters={currentFilters}
        />
        <Link href="/dashboard/applications/add">
          <button className={styles.addButton} type="button">
            <MdAdd /> Add Application
          </button>
        </Link>
      </div>

      {/* Indicateur de loading avec animation */}
      {isPending && (
        <div className={styles.loading}>
          <span className={styles.loadingSpinner}></span>
          Filtering applications...
        </div>
      )}

      {/* Affichage des erreurs */}
      {error && (
        <div className={styles.error}>
          <span className={styles.errorIcon}>⚠️</span>
          {error}
          <button
            className={styles.retryButton}
            onClick={() => handleFilterChange(currentFilters)}
          >
            Retry
          </button>
        </div>
      )}

      <div className={styles.applicationsGrid}>
        {applications && applications.length > 0 ? (
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
                  src={app.application_images[0]}
                  alt={`${app.application_name} image`}
                  className={styles.image}
                />
              </div>

              <div className={styles.applicationDetails}>
                <div className={styles.titleSection}>
                  <h2>{app.application_name}</h2>
                  <div className={styles.categoryIcon}>
                    {app.application_category === 'mobile' && (
                      <MdPhoneIphone className={styles.mobileIcon} />
                    )}
                    {app.application_category === 'web' && (
                      <MdMonitor className={styles.webIcon} />
                    )}
                  </div>
                </div>
                <p className={styles.applicationType}>
                  Level: {app.application_level}
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
                  disabled={app.is_active || isDeleting}
                  className={`${styles.actionButton} ${styles.deleteButton} ${
                    app.is_active ? styles.disabled : ''
                  }`}
                  onClick={() =>
                    !app.is_active &&
                    handleDelete(app.application_id, app.application_images)
                  }
                  title={
                    app.is_active
                      ? 'Cannot delete active application. Please deactivate first.'
                      : 'Delete application'
                  }
                >
                  {isDeleting && deleteId === app.application_id
                    ? 'Deleting...'
                    : 'Delete'}
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className={styles.noResults}>
            <div className={styles.noResultsIcon}>📂</div>
            <p>
              {hasActiveFilters
                ? 'No applications match your current filters.'
                : 'No applications available.'}
            </p>
            {hasActiveFilters && (
              <button
                className={styles.clearFiltersButton}
                onClick={clearAllFilters}
                disabled={isPending}
              >
                Clear All Filters
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default ApplicationsList;
