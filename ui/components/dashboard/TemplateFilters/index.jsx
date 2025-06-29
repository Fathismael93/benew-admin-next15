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
  MdCheckCircle,
  MdCancel,
} from 'react-icons/md';
import styles from './templateFilters.module.css';

const TemplateFilters = ({ onFilterChange, currentFilters = {} }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeFilters, setActiveFilters] = useState({
    template_has_mobile: [],
    template_has_web: [],
    is_active: [],
  });

  const filterRef = useRef(null);

  // Options de filtres
  const filterOptions = {
    template_has_mobile: [
      { value: 'true', label: 'Avec Mobile', icon: <MdPhoneIphone /> },
      { value: 'false', label: 'Sans Mobile', icon: <MdPhoneIphone /> },
    ],
    template_has_web: [
      { value: 'true', label: 'Avec Web', icon: <MdMonitor /> },
      { value: 'false', label: 'Sans Web', icon: <MdMonitor /> },
    ],
    is_active: [
      { value: 'true', label: 'Actif', icon: <MdCheckCircle /> },
      { value: 'false', label: 'Inactif', icon: <MdCancel /> },
    ],
  };

  // Initialiser les filtres depuis les filtres actuels
  useEffect(() => {
    const templateHasMobile = currentFilters.template_has_mobile || [];
    const templateHasWeb = currentFilters.template_has_web || [];
    const isActive = currentFilters.is_active || [];

    setActiveFilters({
      template_has_mobile: Array.isArray(templateHasMobile)
        ? templateHasMobile
        : [templateHasMobile].filter(Boolean),
      template_has_web: Array.isArray(templateHasWeb)
        ? templateHasWeb
        : [templateHasWeb].filter(Boolean),
      is_active: Array.isArray(isActive)
        ? isActive
        : [isActive].filter(Boolean),
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
        ...currentFilters, // Conserver les autres filtres (comme template_name)
      };

      // Ajouter les filtres seulement s'ils ont des valeurs
      if (filters.template_has_mobile.length > 0) {
        serverFilters.template_has_mobile = filters.template_has_mobile;
      } else {
        delete serverFilters.template_has_mobile;
      }

      if (filters.template_has_web.length > 0) {
        serverFilters.template_has_web = filters.template_has_web;
      } else {
        delete serverFilters.template_has_web;
      }

      if (filters.is_active.length > 0) {
        serverFilters.is_active = filters.is_active;
      } else {
        delete serverFilters.is_active;
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
      template_has_mobile: [],
      template_has_web: [],
      is_active: [],
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
            <h3>Filter Templates</h3>
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
            {/* Filtre par Support Mobile */}
            <div className={styles.filterSection}>
              <h4 className={styles.filterTitle}>Support Mobile</h4>
              <div className={styles.filterOptions}>
                {filterOptions.template_has_mobile.map((option) => (
                  <button
                    key={option.value}
                    className={`${styles.filterOption} ${
                      isFilterActive('template_has_mobile', option.value)
                        ? styles.active
                        : ''
                    }`}
                    onClick={() =>
                      handleFilterToggle('template_has_mobile', option.value)
                    }
                    type="button"
                  >
                    <div className={styles.checkbox}>
                      {isFilterActive('template_has_mobile', option.value) ? (
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

            {/* Filtre par Support Web */}
            <div className={styles.filterSection}>
              <h4 className={styles.filterTitle}>Support Web</h4>
              <div className={styles.filterOptions}>
                {filterOptions.template_has_web.map((option) => (
                  <button
                    key={option.value}
                    className={`${styles.filterOption} ${
                      isFilterActive('template_has_web', option.value)
                        ? styles.active
                        : ''
                    }`}
                    onClick={() =>
                      handleFilterToggle('template_has_web', option.value)
                    }
                    type="button"
                  >
                    <div className={styles.checkbox}>
                      {isFilterActive('template_has_web', option.value) ? (
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

            {/* Filtre par Status */}
            <div className={styles.filterSection}>
              <h4 className={styles.filterTitle}>Status</h4>
              <div className={styles.filterOptions}>
                {filterOptions.is_active.map((option) => (
                  <button
                    key={option.value}
                    className={`${styles.filterOption} ${
                      isFilterActive('is_active', option.value)
                        ? styles.active
                        : ''
                    }`}
                    onClick={() =>
                      handleFilterToggle('is_active', option.value)
                    }
                    type="button"
                  >
                    <div className={styles.checkbox}>
                      {isFilterActive('is_active', option.value) ? (
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
          </div>
        </div>
      )}
    </div>
  );
};

export default TemplateFilters;
