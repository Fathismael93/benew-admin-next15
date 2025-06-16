'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  MdAdd,
  MdEdit,
  MdDelete,
  MdMonitor,
  MdPhoneIphone,
  MdCheckCircle,
  MdCancel,
  MdShoppingCart,
  MdDateRange,
  MdUpdate,
  MdWarning,
  MdClose,
} from 'react-icons/md';
import { CldImage } from 'next-cloudinary';

import styles from '@/ui/styling/dashboard/templates/templates.module.css';
import Search from '@/ui/components/dashboard/search';

const ListTemplates = ({ data: initialData }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState(''); // 'active' ou 'confirm'
  const [templateToDelete, setTemplateToDelete] = useState(null);
  const [templates, setTemplates] = useState(initialData);
  // const [deletedTemplates, setDeletedTemplates] = useState(new Set()); // Pour rollback

  const router = useRouter();

  // Mise à jour des templates quand les props changent (après navigation)
  useEffect(() => {
    setTemplates(initialData);
    // setDeletedTemplates(new Set()); // Reset des suppressions optimistes
  }, [initialData]);

  const handleSearchChange = (e) => {
    setSearchTerm(e.target.value);
  };

  const filteredTemplates = templates?.filter((template) =>
    template.template_name.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const handleDeleteClick = (template) => {
    setTemplateToDelete(template);

    // Vérifier si le template est actif
    if (template.is_active) {
      setModalType('active');
    } else {
      setModalType('confirm');
    }

    setShowModal(true);
  };

  // Fonction pour mise à jour optimiste des templates
  // const optimisticUpdateTemplate = useCallback((templateId, updates) => {
  //   setTemplates((prevTemplates) =>
  //     prevTemplates.map((template) =>
  //       template.template_id === templateId
  //         ? { ...template, ...updates }
  //         : template,
  //     ),
  //   );
  // }, []);

  // Fonction pour ajout optimiste d'un template
  // const optimisticAddTemplate = useCallback((newTemplate) => {
  //   setTemplates((prevTemplates) => [...prevTemplates, newTemplate]);
  // }, []);

  // Fonction pour suppression optimiste avec rollback
  const optimisticDeleteTemplate = useCallback((templateId) => {
    // Marquer comme supprimé pour rollback potentiel
    // setDeletedTemplates((prev) => new Set(prev).add(templateId));

    // Supprimer de l'UI
    setTemplates((prevTemplates) =>
      prevTemplates.filter((template) => template.template_id !== templateId),
    );
  }, []);

  // Fonction de rollback en cas d'échec
  const rollbackDelete = useCallback(
    (templateId) => {
      // Restaurer le template s'il était dans les données initiales
      const templateToRestore = initialData.find(
        (t) => t.template_id === templateId,
      );
      if (templateToRestore) {
        setTemplates((prevTemplates) => {
          // Vérifier s'il n'est pas déjà présent
          const exists = prevTemplates.some(
            (t) => t.template_id === templateId,
          );
          if (!exists) {
            return [...prevTemplates, templateToRestore];
          }
          return prevTemplates;
        });
      }

      // Retirer de la liste des supprimés
      // setDeletedTemplates((prev) => {
      //   const newSet = new Set(prev);
      //   newSet.delete(templateId);
      //   return newSet;
      // });
    },
    [initialData],
  );

  const confirmDelete = async () => {
    if (!templateToDelete) return;

    const templateId = templateToDelete.template_id;

    setDeleteId(templateId);
    setIsDeleting(true);
    setShowModal(false);

    // Suppression optimiste
    optimisticDeleteTemplate(templateId);

    try {
      const response = await fetch(
        `/api/dashboard/templates/${templateId}/delete`,
        {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );

      const result = await response.json();

      if (response.ok && result.success) {
        console.log('Template deleted successfully');
        // La suppression optimiste est confirmée, pas besoin de modification supplémentaire
      } else {
        // Rollback en cas d'échec
        console.error(
          'Failed to delete template:',
          result.message || 'Unknown error',
        );

        rollbackDelete(templateId);

        // Afficher un message d'erreur plus user-friendly
        const errorMessage =
          result.message || 'Erreur lors de la suppression du template';
        alert(errorMessage);
      }
    } catch (error) {
      console.error('Error deleting template:', error);

      // Rollback en cas d'erreur réseau
      rollbackDelete(templateId);

      alert('Erreur de connexion lors de la suppression du template');
    } finally {
      setIsDeleting(false);
      setDeleteId(null);
      setTemplateToDelete(null);
      router.refresh(); // Rafraîchir la page pour mettre à jour l'état
    }
  };

  const cancelDelete = () => {
    setShowModal(false);
    setTemplateToDelete(null);
    setModalType('');
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  // Fonction pour actualiser manuellement la liste (utile pour les cas edge)
  const refreshTemplates = useCallback(() => {
    window.location.reload();
  }, [router]);

  // Modal de confirmation/avertissement
  const renderModal = () => {
    if (!showModal || !templateToDelete) return null;

    return (
      <div className={styles.modalOverlay} onClick={cancelDelete}>
        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
          <div className={styles.modalHeader}>
            <div className={styles.modalIcon}>
              {modalType === 'active' ? (
                <MdWarning className={styles.warningIcon} />
              ) : (
                <MdDelete className={styles.deleteIcon} />
              )}
            </div>
            <button className={styles.closeButton} onClick={cancelDelete}>
              <MdClose />
            </button>
          </div>

          <div className={styles.modalContent}>
            {modalType === 'active' ? (
              <>
                <h3 className={styles.modalTitle}>Template actif</h3>
                <p className={styles.modalMessage}>
                  Le template &quot;
                  <strong>{templateToDelete.template_name}</strong>&quot; ne
                  peut pas être supprimé car il est actuellement actif.
                </p>
                <p className={styles.modalSubmessage}>
                  Veuillez d&apos;abord désactiver ce template avant de pouvoir
                  le supprimer.
                </p>
              </>
            ) : (
              <>
                <h3 className={styles.modalTitle}>Confirmer la suppression</h3>
                <p className={styles.modalMessage}>
                  Êtes-vous sûr de vouloir supprimer le template &quot;
                  <strong>{templateToDelete.template_name}</strong>&quot; ?
                </p>
                <p className={styles.modalSubmessage}>
                  Cette action est irréversible. Le template et son image
                  associée seront définitivement supprimés.
                </p>
              </>
            )}
          </div>

          <div className={styles.modalActions}>
            {modalType === 'active' ? (
              <button
                className={styles.modalButtonPrimary}
                onClick={cancelDelete}
              >
                Compris
              </button>
            ) : (
              <>
                <button
                  className={styles.modalButtonSecondary}
                  onClick={cancelDelete}
                >
                  Annuler
                </button>
                <button
                  className={styles.modalButtonDanger}
                  onClick={confirmDelete}
                  disabled={isDeleting}
                >
                  {isDeleting ? 'Suppression...' : 'Supprimer'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={styles.container}>
      <div className={styles.top}>
        <Search
          placeholder="Search for a template..."
          value={searchTerm}
          onChange={handleSearchChange}
        />
        <div className={styles.headerActions}>
          <button
            className={styles.refreshButton}
            onClick={refreshTemplates}
            title="Actualiser la liste"
          >
            <MdUpdate />
          </button>
          <Link href="/dashboard/templates/add">
            <button className={styles.addButton} type="button">
              <MdAdd /> Template
            </button>
          </Link>
        </div>
      </div>
      <div className={styles.bottom}>
        {templates?.length === 0 ? (
          <div className={styles.noTemplates}>
            <p>No templates found. Add your first template.</p>
          </div>
        ) : (
          <div className={styles.grid}>
            {filteredTemplates?.map((template) => (
              <div
                key={template.template_id}
                className={`${styles.card} ${
                  template.is_active ? styles.activeCard : styles.inactiveCard
                } ${
                  '' /*
                  deletedTemplates.has(template.template_id)
                    ? styles.deletingCard
                    : ''
                */
                }`}
              >
                <div className={styles.imageContainer}>
                  {template.template_image ? (
                    <CldImage
                      src={template.template_image}
                      alt={template.template_name}
                      width={300}
                      height={200}
                      crop="fill"
                      className={styles.templateImage}
                    />
                  ) : (
                    <div className={styles.noImage}>
                      <span>No Image</span>
                    </div>
                  )}
                  {/* Status badge */}
                  <div
                    className={`${styles.statusBadge} ${
                      template.is_active
                        ? styles.activeBadge
                        : styles.inactiveBadge
                    }`}
                  >
                    {template.is_active ? <MdCheckCircle /> : <MdCancel />}
                    <span>{template.is_active ? 'Actif' : 'Inactif'}</span>
                  </div>
                </div>
                <div className={styles.cardContent}>
                  <div className={styles.informations}>
                    <h3 className={styles.templateName}>
                      {template.template_name}
                    </h3>
                    <div className={styles.platforms}>
                      <MdMonitor />
                      {template.template_has_mobile && <MdPhoneIphone />}
                    </div>
                  </div>

                  {/* Nouvelles informations */}
                  <div className={styles.templateStats}>
                    <div className={styles.stat}>
                      <MdShoppingCart className={styles.statIcon} />
                      <span className={styles.statValue}>
                        {template.sales_count}
                      </span>
                      <span className={styles.statLabel}>ventes</span>
                    </div>
                    <div className={styles.stat}>
                      <MdDateRange className={styles.statIcon} />
                      <span className={styles.statValue}>
                        {formatDate(template.template_added)}
                      </span>
                      <span className={styles.statLabel}>créé</span>
                    </div>
                    <div className={styles.stat}>
                      <MdUpdate className={styles.statIcon} />
                      <span className={styles.statValue}>
                        {formatDate(template.updated_at)}
                      </span>
                      <span className={styles.statLabel}>mis à jour</span>
                    </div>
                  </div>

                  <div className={styles.actions}>
                    <Link href={`/dashboard/templates/${template.template_id}`}>
                      <button
                        className={`${styles.actionButton} ${styles.editButton}`}
                        // disabled={deletedTemplates.has(template.template_id)}
                      >
                        <MdEdit />
                      </button>
                    </Link>
                    <button
                      className={`${styles.actionButton} ${styles.deleteButton} ${
                        template.is_active ? styles.disabledButton : ''
                      }`}
                      onClick={() => handleDeleteClick(template)}
                      // disabled={
                      //   (isDeleting && deleteId === template.template_id) ||
                      //   deletedTemplates.has(template.template_id)
                      // }
                      title={
                        template.is_active
                          ? 'Ce template est actif et ne peut pas être supprimé'
                          : 'Supprimer ce template'
                      }
                    >
                      <MdDelete />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal de confirmation/avertissement */}
      {renderModal()}
    </div>
  );
};

export default ListTemplates;
