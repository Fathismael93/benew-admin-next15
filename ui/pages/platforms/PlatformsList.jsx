'use client';

import React from 'react';
import styles from '@/ui/styling/dashboard/platforms/platforms.module.css';

const PlatformsList = () => {
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
    </div>
  );
};

export default PlatformsList;
