// ui/pages/platforms/AddPlatform.js (Client Component)

'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import axios from 'axios';
import styles from '@/ui/styling/dashboard/platforms/add/addPlatform.module.css';
import { MdArrowBack } from 'react-icons/md';
import Link from 'next/link';

function AddPlatform() {
  const router = useRouter();

  const [platformName, setPlatformName] = useState('');
  const [platformNumber, setPlatformNumber] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!platformName || platformName.length < 3) {
      setErrorMessage('Platform name is missing or too short');
      return;
    }

    if (!platformNumber || platformNumber.length < 3) {
      setErrorMessage('Platform number is missing or too short');
      return;
    }

    const response = await axios.post(
      '/api/dashboard/platforms/add',
      JSON.stringify({
        platformName,
        platformNumber,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      },
    );

    if (response.data.success) {
      router.push('/dashboard/platforms');
    }
  };

  return (
    <div className={styles.addPlatformContainer}>
      <Link href="/dashboard/platforms" className={styles.backButton}>
        <MdArrowBack /> Back to Platforms
      </Link>
      <h1>Add Payment Platform</h1>
      <form className={styles.addPlatformForm} onSubmit={handleSubmit}>
        {errorMessage && <p className={styles.errorMessage}>{errorMessage}</p>}
        <div className={styles.inputs}>
          <input
            type="text"
            name="platformName"
            placeholder="Platform Name"
            value={platformName}
            onChange={(e) => setPlatformName(e.target.value)}
          />
          <input
            type="text"
            name="platformNumber"
            placeholder="Platform Number"
            value={platformNumber}
            onChange={(e) => setPlatformNumber(e.target.value)}
          />
        </div>
        <button type="submit" className={styles.addButton}>
          Add Platform
        </button>
      </form>
    </div>
  );
}

export default AddPlatform;
