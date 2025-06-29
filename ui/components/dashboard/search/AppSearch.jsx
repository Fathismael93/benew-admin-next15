'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MdSearch } from 'react-icons/md';
import styles from './search.module.css';

function AppSearch({ placeholder }) {
  const [searchTerm, setSearchTerm] = useState('');
  const router = useRouter();
  const searchParams = useSearchParams();

  // Initialiser le terme de recherche depuis l'URL au chargement
  useEffect(() => {
    const applicationName = searchParams.get('application_name') || '';
    setSearchTerm(applicationName);
  }, [searchParams]);

  // Fonction pour mettre à jour l'URL avec le terme de recherche
  const updateURL = (term) => {
    const params = new URLSearchParams(searchParams);

    if (term.trim()) {
      params.set('application_name', term);
    } else {
      params.delete('application_name');
    }

    const queryString = params.toString();
    const newURL = queryString ? `?${queryString}` : window.location.pathname;

    router.push(newURL, { scroll: false });
  };

  // Gérer le changement dans l'input
  const handleSearchChange = (e) => {
    const value = e.target.value;
    setSearchTerm(value);

    // Utiliser un debounce pour éviter trop de requêtes
    const timeoutId = setTimeout(() => {
      updateURL(value);
    }, 500);

    // Nettoyer le timeout précédent
    return () => clearTimeout(timeoutId);
  };

  return (
    <div className={styles.container}>
      <MdSearch alt="search icon" />
      <input
        id="searchApp"
        type="text"
        placeholder={placeholder}
        className={styles.input}
        value={searchTerm}
        onChange={handleSearchChange}
      />
    </div>
  );
}

export default AppSearch;
