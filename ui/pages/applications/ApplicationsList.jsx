'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CldImage } from 'next-cloudinary';
import axios from 'axios';
import styles from '@/ui/styling/dashboard/applications/applicationsList.module.css';
import Search from '@/ui/components/dashboard/search';
import AppFilters from '@ui/components/dashboard/AppFilters';
import Link from 'next/link';
import { MdAdd, MdMonitor, MdPhoneIphone } from 'react-icons/md';

function ApplicationsList({ data }) {
  const [applications, setApplications] = useState(data);
  const [searchTerm, setSearchTerm] = useState('');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteId, setDeleteId] = useState(null);

  useEffect(() => {
    setApplications(data);
  }, [data, deleteId, isDeleting]);

  // Fonction de filtrage avec useMemo pour optimiser les performances
  const filteredApplications = useMemo(() => {
    if (!applications) return [];

    // Récupérer les filtres depuis l'URL
    const categoryFilters = searchParams.getAll('category');
    const levelFilters = searchParams.getAll('level');
    const statusFilters = searchParams.getAll('status');

    return applications.filter((app) => {
      // Filtrage par recherche textuelle
      const matchesSearch =
        searchTerm === '' ||
        app.application_name.toLowerCase().includes(searchTerm.toLowerCase());

      // Filtrage par catégorie
      const matchesCategory =
        categoryFilters.length === 0 ||
        categoryFilters.includes(app.application_category);

      // Filtrage par level
      const matchesLevel =
        levelFilters.length === 0 ||
        levelFilters.includes(String(app.application_level));

      // Filtrage par status (active/inactive)
      const matchesStatus =
        statusFilters.length === 0 ||
        statusFilters.includes(String(app.is_active));

      return matchesSearch && matchesCategory && matchesLevel && matchesStatus;
    });
  }, [applications, searchParams, searchTerm]);

  // Fonction pour gérer le changement de recherche
  const handleSearchChange = (e) => {
    setSearchTerm(e.target.value);
  };

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
        router.push('/dashboard/applications'); // Refresh the page to reflect changes
      }
    }
  };

  return (
    <div className={styles.applicationsContainer}>
      <div className={styles.top}>
        <Search
          placeholder="Search for an application..."
          value={searchTerm}
          onChange={handleSearchChange}
        />
        <AppFilters />
        <Link href="/dashboard/applications/add">
          <button className={styles.addButton} type="button">
            <MdAdd /> Add Application
          </button>
        </Link>
      </div>
      <div className={styles.applicationsGrid}>
        {filteredApplications.length > 0 ? (
          filteredApplications.map((app) => (
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
                  Delete
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className={styles.noResults}>
            <p>
              {searchTerm || searchParams.toString()
                ? 'No applications found matching your criteria.'
                : 'No applications available.'}
            </p>
            {(searchTerm || searchParams.toString()) && (
              <button
                className={styles.clearFiltersButton}
                onClick={() => {
                  setSearchTerm('');
                  router.push('/dashboard/applications');
                }}
              >
                Clear all filters
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default ApplicationsList;
