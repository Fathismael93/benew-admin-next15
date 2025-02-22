// ui/pages/platforms/PlatformsList.js (Client Component)

'use client';

import React from 'react';
import styles from '@/ui/styling/dashboard/platforms/platforms.module.css';
import Search from '@/ui/components/dashboard/search';
import Link from 'next/link';
import { MdAdd } from 'react-icons/md';

const PlatformsList = ({ platforms }) => {
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
                <Link
                  href={`/dashboard/platforms/edit/${platform.platform_id}`}
                  className={`${styles.actionLink} ${styles.editLink}`}
                >
                  Edit
                </Link>
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
