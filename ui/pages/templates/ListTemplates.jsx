'use client';

import { useEffect, useState } from 'react';
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
} from 'react-icons/md';
import { CldImage } from 'next-cloudinary';

import styles from '@/ui/styling/dashboard/templates/templates.module.css';
import Search from '@/ui/components/dashboard/search';

const ListTemplates = ({ data }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteId, setDeleteId] = useState(null);

  const [templates, setTemplates] = useState(data);

  useEffect(() => {
    setTemplates(data);
  }, [deleteId, isDeleting]);

  console.log('templates: ');
  console.log(templates);

  const handleSearchChange = (e) => {
    setSearchTerm(e.target.value);
  };

  const filteredTemplates = templates?.filter((template) =>
    template.template_name.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const handleDeleteClick = async (id) => {
    setDeleteId(id);
    setIsDeleting(true);

    try {
      const response = await fetch(`/api/dashboard/templates/${id}/delete`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        // Remove the template from the UI without refreshing
        window.location.reload();
      } else {
        console.error('Failed to delete template');
      }
    } catch (error) {
      console.error('Error deleting template:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  return (
    <div className={styles.container}>
      <div className={styles.top}>
        <Search
          placeholder="Search for a template..."
          value={searchTerm}
          onChange={handleSearchChange}
        />
        <Link href="/dashboard/templates/add">
          <button className={styles.addButton} type="button">
            <MdAdd /> Template
          </button>
        </Link>
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
                className={`${styles.card} ${template.is_active ? styles.activeCard : styles.inactiveCard}`}
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
                    className={`${styles.statusBadge} ${template.is_active ? styles.activeBadge : styles.inactiveBadge}`}
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
                      >
                        <MdEdit />
                      </button>
                    </Link>
                    <button
                      className={`${styles.actionButton} ${styles.deleteButton}`}
                      onClick={() => handleDeleteClick(template.template_id)}
                      disabled={isDeleting && deleteId === template.template_id}
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
    </div>
  );
};

export default ListTemplates;
