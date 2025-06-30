'use client';

import { useState, useEffect, useRef } from 'react';
import { MdSearch } from 'react-icons/md';
import styles from './search.module.css';

function BlogSearch({ placeholder, onFilterChange, currentFilters = {} }) {
  const [searchTerm, setSearchTerm] = useState('');
  const debounceRef = useRef(null);

  // Initialiser le terme de recherche seulement au montage du composant
  useEffect(() => {
    const articleTitle = currentFilters.article_title || '';
    setSearchTerm(articleTitle);
  }, []); // Tableau vide = exécution une seule fois au montage

  // Fonction pour notifier le changement de filtre
  const notifyFilterChange = (term) => {
    if (onFilterChange) {
      const newFilters = {
        ...currentFilters,
        article_title: term.trim() || undefined,
      };

      // Nettoyer les valeurs undefined
      Object.keys(newFilters).forEach((key) => {
        if (newFilters[key] === undefined) {
          delete newFilters[key];
        }
      });

      onFilterChange(newFilters);
    }
  };

  // Gérer le changement dans l'input avec debouncing
  const handleSearchChange = (e) => {
    const value = e.target.value;
    setSearchTerm(value);

    // Nettoyer le timeout précédent
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    // Créer un nouveau timeout
    debounceRef.current = setTimeout(() => {
      notifyFilterChange(value);
    }, 300); // Debounce réduit à 300ms pour plus de réactivité
  };

  // Nettoyer le timeout au démontage du composant
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  return (
    <div className={styles.container}>
      <MdSearch alt="search icon" />
      <input
        id="searchBlog"
        type="text"
        placeholder={placeholder}
        className={styles.input}
        value={searchTerm}
        onChange={handleSearchChange}
      />
    </div>
  );
}

export default BlogSearch;
