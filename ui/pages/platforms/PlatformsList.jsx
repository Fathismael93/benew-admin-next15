'use client';

import { useEffect, useState } from 'react';
import styles from '@/ui/styling/dashboard/platforms/platforms.module.css';
import Search from '@/ui/components/dashboard/search';
import Link from 'next/link';
import { MdAdd } from 'react-icons/md';
import { useRouter } from 'next/navigation';

const PlatformsList = ({ data }) => {
  const [platforms, setPlatforms] = useState(data);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteId, setDeleteId] = useState(null);

  const router = useRouter();

  useEffect(() => {
    setPlatforms(data);
  }, [deleteId, isDeleting]);

  const handleDelete = async (id) => {
    if (confirm('Are you sure you want to delete this platform?')) {
      setDeleteId(id);
      setIsDeleting(true);

      try {
        const response = await fetch(`/api/dashboard/platforms/${id}/delete`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        // Vérifier si la réponse est ok
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (data.success) {
          setIsDeleting(false);
          router.refresh(); // Refresh the page to reflect changes
        }
      } catch (error) {
        console.error('Delete error:', error);
        setIsDeleting(false);
        // Optionnel: ajouter une gestion d'erreur utilisateur
        alert('Failed to delete platform. Please try again.');
      }
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.top}>
        <Search placeholder="Search for a platform..." />
        <Link href="/dashboard/platforms/add">
          <button className={styles.addButton} type="button">
            <MdAdd /> Platform
          </button>
        </Link>
      </div>
      <div className={styles.platformsGrid}>
        {platforms !== undefined &&
          platforms.map((platform) => (
            <div
              key={platform.platform_id}
              className={`${styles.platformCard} ${platform.is_active ? styles.active : styles.inactive}`}
            >
              <div className={styles.platformDetails}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                  }}
                >
                  <h2>{platform.platform_name}</h2>
                  <span
                    className={`${styles.statusBadge} ${platform.is_active ? styles.active : styles.inactive}`}
                  >
                    {platform.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>

                <div className={styles.platformInfo}>
                  <div className={styles.infoRow}>
                    <span className={styles.label}>ID:</span>
                    <span className={styles.value}>{platform.platform_id}</span>
                  </div>

                  <div className={styles.infoRow}>
                    <span className={styles.label}>Number:</span>
                    <span className={styles.value}>
                      {platform.platform_number}
                    </span>
                  </div>

                  <div className={styles.infoRow}>
                    <span className={styles.label}>Created:</span>
                    <span className={styles.value}>
                      {new Date(platform.created_at).toLocaleDateString(
                        'en-US',
                        {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        },
                      )}
                    </span>
                  </div>

                  {platform.updated_at && (
                    <div className={styles.infoRow}>
                      <span className={styles.label}>Updated:</span>
                      <span className={styles.value}>
                        {new Date(platform.updated_at).toLocaleDateString(
                          'en-US',
                          {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          },
                        )}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <div className={styles.platformActions}>
                <Link
                  href={`/dashboard/platforms/edit/${platform.platform_id}`}
                >
                  <button
                    className={`${styles.actionButton} ${styles.editButton}`}
                  >
                    Edit
                  </button>
                </Link>
                <button
                  disabled={platform.is_active || isDeleting}
                  className={`${styles.actionButton} ${styles.deleteButton} ${
                    platform.is_active ? styles.disabled : ''
                  }`}
                  onClick={() =>
                    !platform.is_active && handleDelete(platform.platform_id)
                  }
                  title={
                    platform.is_active
                      ? 'Cannot delete active platform. Please deactivate first.'
                      : 'Delete platform'
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
};

export default PlatformsList;
