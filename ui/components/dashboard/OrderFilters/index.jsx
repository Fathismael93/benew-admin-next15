'use client';

import { useState, useEffect, useRef } from 'react';
import {
  MdFilterList,
  MdClose,
  MdClear,
  MdCheckBox,
  MdCheckBoxOutlineBlank,
  MdCheckCircle,
  MdPending,
  MdUndo,
  MdError,
} from 'react-icons/md';
import styles from './orderFilters.module.css';

const OrderFilters = ({ onFilterChange, currentFilters = {} }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeFilters, setActiveFilters] = useState({
    order_payment_status: [],
  });

  const filterRef = useRef(null);

  // Options de filtres pour les statuts de paiement
  const filterOptions = {
    order_payment_status: [
      { value: 'paid', label: 'Payée', icon: <MdCheckCircle /> },
      { value: 'unpaid', label: 'En attente', icon: <MdPending /> },
      { value: 'refunded', label: 'Remboursée', icon: <MdUndo /> },
      { value: 'failed', label: 'Échouée', icon: <MdError /> },
    ],
  };

  // Initialiser les filtres depuis les filtres actuels
  useEffect(() => {
    const orderPaymentStatus = currentFilters.order_payment_status || [];

    setActiveFilters({
      order_payment_status: Array.isArray(orderPaymentStatus)
        ? orderPaymentStatus
        : [orderPaymentStatus].filter(Boolean),
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
    console.log(
      '🔍 [DEBUG] OrderFilters notifyFilterChange called with:',
      filters,
    );

    if (onFilterChange) {
      // Construire l'objet de filtres pour la Server Action
      const serverFilters = {
        ...currentFilters, // Conserver les autres filtres (comme order_client)
      };

      // Ajouter les filtres de statut seulement s'ils ont des valeurs
      if (filters.order_payment_status.length > 0) {
        serverFilters.order_payment_status = filters.order_payment_status;
      } else {
        delete serverFilters.order_payment_status;
      }

      console.log('🔍 [DEBUG] OrderFilters sending filters:', serverFilters);
      onFilterChange(serverFilters);
    } else {
      console.log('❌ [DEBUG] OrderFilters: onFilterChange not available');
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
      order_payment_status: [],
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
            <h3>Filter Orders</h3>
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
            {/* Filtre par Statut de Paiement */}
            <div className={styles.filterSection}>
              <h4 className={styles.filterTitle}>Payment Status</h4>
              <div className={styles.filterOptions}>
                {filterOptions.order_payment_status.map((option) => (
                  <button
                    key={option.value}
                    className={`${styles.filterOption} ${
                      isFilterActive('order_payment_status', option.value)
                        ? styles.active
                        : ''
                    }`}
                    onClick={() =>
                      handleFilterToggle('order_payment_status', option.value)
                    }
                    type="button"
                  >
                    <div className={styles.checkbox}>
                      {isFilterActive('order_payment_status', option.value) ? (
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

export default OrderFilters;
