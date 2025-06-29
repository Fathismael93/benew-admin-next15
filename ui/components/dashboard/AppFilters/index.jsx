'use client';

import { useState, useEffect, useRef } from 'react';
import {
  MdFilterList,
  MdClose,
  MdClear,
  MdCheckBox,
  MdCheckBoxOutlineBlank,
  MdPhoneIphone,
  MdMonitor,
} from 'react-icons/md';
import styles from './appFilters.module.css';

const AppFilters = ({ onFilterChange, currentFilters = {} }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeFilters, setActiveFilters] = useState({
    category: [],
    level: [],
    status: [],
  });

  const filterRef = useRef(null);

  // Options de filtres
  const filterOptions = {
    category: [
      { value: 'mobile', label: 'Mobile', icon: <MdPhoneIphone /> },
      { value: 'web', label: 'Web', icon: <MdMonitor /> },
    ],
    level: [
      { value: '1', label: 'Level 1' },
      { value: '2', label: 'Level 2' },
      { value: '3', label: 'Level 3' },
      { value: '4', label: 'Level 4' },
    ],
    status: [
      { value: 'true', label: 'Active' },
      { value: 'false', label: 'Inactive' },
    ],
  };

  // Initialiser les filtres depuis les filtres actuels
  useEffect(() => {
    const category = currentFilters.category || [];
    const level = currentFilters.level || [];
    const status = currentFilters.status || [];

    setActiveFilters({
      category: Array.isArray(category) ? category : [category].filter(Boolean),
      level: Array.isArray(level) ? level : [level].filter(Boolean),
      status: Array.isArray(status) ? status : [status].filter(Boolean),
    });
  }, [currentFilters]);

  // Fermer le filtre en cliquant à l'extérieur
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (filterRef.current && !filterRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Compter le nombre total de filtres actifs
  const totalActiveFilters = Object.values(activeFilters).flat().length;

  // Fonction pour notifier le changement de filtre
  const notifyFilterChange = (filters) => {
    if (onFilterChange) {
      // Construire l'objet de filtres pour la Server Action
      const serverFilters = {
        ...currentFilters, // Conserver les autres filtres (comme application_name)
      };

      // Ajouter les filtres de catégorie, level et status seulement s'ils ont des valeurs
      if (filters.category.length > 0) {
        serverFilters.category = filters.category;
      } else {
        delete serverFilters.category;
      }

      if (filters.level.length > 0) {
        serverFilters.level = filters.level;
      } else {
        delete serverFilters.level;
      }

      if (filters.status.length > 0) {
        serverFilters.status = filters.status;
      } else {
        delete serverFilters.status;
      }

      onFilterChange(serverFilters);
    }
  };

  // Gérer l'ajout/suppression d'un filtre
  const handleFilterToggle = (filterType, value) => {
    const currentFilters = [...activeFilters[filterType]];
    const index = currentFilters.indexOf(value);

    if (index > -1) {
      // Supprimer le filtre s'il existe
      currentFilters.splice(index, 1);
    } else {
      // Ajouter le filtre s'il n'existe pas
      currentFilters.push(value);
    }

    const newActiveFilters = {
      ...activeFilters,
      [filterType]: currentFilters,
    };

    setActiveFilters(newActiveFilters);
    notifyFilterChange(newActiveFilters);
  };

  // Réinitialiser tous les filtres
  const clearAllFilters = () => {
    const emptyFilters = {
      category: [],
      level: [],
      status: [],
    };

    setActiveFilters(emptyFilters);
    notifyFilterChange(emptyFilters);
  };

  // Vérifier si un filtre est actif
  const isFilterActive = (filterType, value) => {
    return activeFilters[filterType].includes(value);
  };

  return (
    <div className={styles.filterContainer} ref={filterRef}>
      <button
        className={`${styles.filterButton} ${totalActiveFilters > 0 ? styles.hasActiveFilters : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <MdFilterList className={styles.filterIcon} />
        <span>Filters</span>
        {totalActiveFilters > 0 && (
          <span className={styles.filterCount}>{totalActiveFilters}</span>
        )}
      </button>

      {isOpen && (
        <div className={styles.filterDropdown}>
          <div className={styles.filterHeader}>
            <h3>Filter Applications</h3>
            <div className={styles.headerActions}>
              {totalActiveFilters > 0 && (
                <button
                  className={styles.clearAllButton}
                  onClick={clearAllFilters}
                  type="button"
                >
                  <MdClear />
                  Clear All
                </button>
              )}
              <button
                className={styles.closeButton}
                onClick={() => setIsOpen(false)}
                type="button"
              >
                <MdClose />
              </button>
            </div>
          </div>

          <div className={styles.filterContent}>
            {/* Filtre par Catégorie */}
            <div className={styles.filterSection}>
              <h4 className={styles.filterTitle}>Category</h4>
              <div className={styles.filterOptions}>
                {filterOptions.category.map((option) => (
                  <button
                    key={option.value}
                    className={`${styles.filterOption} ${
                      isFilterActive('category', option.value)
                        ? styles.active
                        : ''
                    }`}
                    onClick={() => handleFilterToggle('category', option.value)}
                    type="button"
                  >
                    <div className={styles.checkbox}>
                      {isFilterActive('category', option.value) ? (
                        <MdCheckBox className={styles.checkedIcon} />
                      ) : (
                        <MdCheckBoxOutlineBlank
                          className={styles.uncheckedIcon}
                        />
                      )}
                    </div>
                    <span className={styles.optionIcon}>{option.icon}</span>
                    <span className={styles.optionLabel}>{option.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Filtre par Level */}
            <div className={styles.filterSection}>
              <h4 className={styles.filterTitle}>Level</h4>
              <div className={styles.filterOptions}>
                {filterOptions.level.map((option) => (
                  <button
                    key={option.value}
                    className={`${styles.filterOption} ${
                      isFilterActive('level', option.value) ? styles.active : ''
                    }`}
                    onClick={() => handleFilterToggle('level', option.value)}
                    type="button"
                  >
                    <div className={styles.checkbox}>
                      {isFilterActive('level', option.value) ? (
                        <MdCheckBox className={styles.checkedIcon} />
                      ) : (
                        <MdCheckBoxOutlineBlank
                          className={styles.uncheckedIcon}
                        />
                      )}
                    </div>
                    <span className={styles.optionLabel}>{option.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Filtre par Status */}
            <div className={styles.filterSection}>
              <h4 className={styles.filterTitle}>Status</h4>
              <div className={styles.filterOptions}>
                {filterOptions.status.map((option) => (
                  <button
                    key={option.value}
                    className={`${styles.filterOption} ${
                      isFilterActive('status', option.value)
                        ? styles.active
                        : ''
                    }`}
                    onClick={() => handleFilterToggle('status', option.value)}
                    type="button"
                  >
                    <div className={styles.checkbox}>
                      {isFilterActive('status', option.value) ? (
                        <MdCheckBox className={styles.checkedIcon} />
                      ) : (
                        <MdCheckBoxOutlineBlank
                          className={styles.uncheckedIcon}
                        />
                      )}
                    </div>
                    <span className={styles.optionLabel}>{option.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AppFilters;
