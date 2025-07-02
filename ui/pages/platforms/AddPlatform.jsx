// ui/pages/platforms/AddPlatform.js (Client Component)

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from '@/ui/styling/dashboard/platforms/add/addPlatform.module.css';
import { MdArrowBack } from 'react-icons/md';
import Link from 'next/link';
import { platformAddingSchema } from '@/utils/schemas/platformSchema';

function AddPlatform() {
  const router = useRouter();

  const [platformName, setPlatformName] = useState('');
  const [platformNumber, setPlatformNumber] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');

    // Vérifications de base pour les champs requis
    if (!platformName || platformName.length < 3) {
      setErrorMessage(
        'Platform name is required and must be at least 3 characters',
      );
      return;
    }

    if (!platformNumber || platformNumber.length < 3) {
      setErrorMessage(
        'Platform number is required and must be at least 3 characters',
      );
      return;
    }

    // Vérifier que le nom commence par une lettre
    if (!/^[a-zA-Z]/.test(platformName.trim())) {
      setErrorMessage('Platform name must start with a letter');
      return;
    }

    // Vérifier que le numéro contient au moins un caractère alphanumérique
    if (!/[a-zA-Z0-9]/.test(platformNumber.trim())) {
      setErrorMessage(
        'Platform number must contain at least one alphanumeric character',
      );
      return;
    }

    // Préparer les données pour la sanitization et validation
    const formData = {
      platformName,
      platformNumber,
    };

    try {
      // 2. Validation avec platformAddingSchema
      await platformAddingSchema.validate(formData, { abortEarly: false });

      // 3. Si validation réussie, procéder à l'envoi
      const response = await fetch('/api/dashboard/platforms/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      // Vérifier si la réponse est ok
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.platform) {
        router.push('/dashboard/platforms');
      } else {
        setErrorMessage(data.message || 'Failed to add platform');
      }
    } catch (validationError) {
      if (validationError.name === 'ValidationError') {
        // Erreurs de validation Yup - afficher la première erreur
        const firstError = validationError.errors[0];
        setErrorMessage(firstError || 'Validation failed');
      } else if (validationError.message?.includes('HTTP error')) {
        // Erreurs HTTP
        setErrorMessage('Server error occurred');
      } else {
        // Autres erreurs (réseau, etc.)
        setErrorMessage(
          validationError.message ||
            'An error occurred while adding the platform',
        );
      }
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
            placeholder="Platform Name (e.g., PayPal, Stripe)"
            value={platformName}
            onChange={(e) => setPlatformName(e.target.value)}
            maxLength="50"
            required
          />
          <input
            type="text"
            name="platformNumber"
            placeholder="Platform Number or Code (e.g., +33123456789, PAYPAL_001)"
            value={platformNumber}
            onChange={(e) => setPlatformNumber(e.target.value)}
            maxLength="50"
            required
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
