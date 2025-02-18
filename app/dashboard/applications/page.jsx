'use client';

import { React, useEffect, useState } from 'react';
import axios from 'axios';
import { CldImage } from 'next-cloudinary';
import Link from 'next/link';
import { MdAdd } from 'react-icons/md';
import styles from '@/ui/styling/dashboard/applications/applications.module.css';
import Search from '@/ui/components/dashboard/search';

function ApplicationsPage() {
  // eslint-disable-next-line no-unused-vars
  const [applications, setApplications] = useState('');

  useEffect(() => {
    async function getApplications() {
      await axios
        .get('/api/dashboard/applications')
        .then((response) => console.log(response.data.data.rows))
        .catch((error) => console.error(error));
    }

    getApplications();
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.top}>
        <Search placeholder="Search for an application..." />
        <Link href="/dashboard/applications/add">
          <button className={styles.addButton} type="button">
            <MdAdd /> Application
          </button>
        </Link>
      </div>
      <div className={styles.presentationsContainer}>
        {applications.length > 0
          ? applications.map(
              ({
                // eslint-disable-next-line camelcase
                application_id,
              }) => {
                return (
                  // eslint-disable-next-line camelcase
                  <div key={application_id}>
                    <div>
                      <CldImage />
                    </div>
                  </div>
                );
              },
            )
          : ''}
      </div>
    </div>
  );
}

export default ApplicationsPage;
