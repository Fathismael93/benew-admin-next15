'use client';

import React, { useEffect, useState } from 'react';
import styles from '@/ui/styling/dashboard/platforms/platforms.module.css';
import Search from '@/ui/components/dashboard/search';
import Link from 'next/link';
import { MdAdd } from 'react-icons/md';
import { useRouter } from 'next/navigation';
import axios from 'axios';

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

      const response = await axios.delete(
        `/api/dashboard/platforms/delete?id=${id}`,
      );

      if (response.data.success) {
        setIsDeleting(false);
        router.refresh(); // Refresh the page to reflect changes
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
            <div key={platform.platform_id} className={styles.platformCard}>
              <div className={styles.platformDetails}>
                <h2>{platform.platform_name}</h2>
                <p>{platform.platform_number}</p>
              </div>
              <div className={styles.platformActions}>
                <button
                  className={`${styles.actionButton} ${styles.deleteButton}`}
                  onClick={() => handleDelete(platform.platform_id)}
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
