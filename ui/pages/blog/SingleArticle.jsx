'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CldImage } from 'next-cloudinary';
import parse from 'html-react-parser';
import styles from '@/ui/styling/dashboard/blog/view-article/view.module.css';

const SingleArticle = ({ article }) => {
  const [data, setData] = useState(article);
  const [isLoading, setIsLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [copied, setCopied] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setData(article);
    setImageError(false);
  }, [article]);

  // Fonction pour copier le lien de l'article
  const copyArticleLink = async () => {
    try {
      const articleUrl = `${window.location.origin}/blog/${data.article_id}`;
      await navigator.clipboard.writeText(articleUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy link:', error);
    }
  };

  // Fonction pour basculer le statut de l'article
  const toggleArticleStatus = async () => {
    if (!data) return;

    setIsLoading(true);
    try {
      const response = await fetch(
        `/api/dashboard/blog/${data.article_id}/toggle-status`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );

      if (response.ok) {
        const result = await response.json();
        setData((prev) => ({
          ...prev,
          is_active: result.data.is_active,
        }));
      } else {
        console.error('Failed to toggle article status');
      }
    } catch (error) {
      console.error('Error toggling article status:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Fonction de suppression avec confirmation
  const deleteArticle = async () => {
    if (!data) return;

    setIsLoading(true);
    try {
      const response = await fetch(
        `/api/dashboard/blog/${data.article_id}/delete`,
        {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ imageID: data.article_image }),
        },
      );

      if (response.ok) {
        router.push('/dashboard/blog/');
      } else {
        console.error('Failed to delete article');
      }
    } catch (error) {
      console.error('Error deleting article:', error);
    } finally {
      setIsLoading(false);
      setShowDeleteConfirm(false);
    }
  };

  // Calculer l'estimation du temps de lecture
  const calculateReadingTime = (text) => {
    if (!text) return 0;
    const wordsPerMinute = 200;
    const plainText = text.replace(/<[^>]*>/g, ''); // Retirer les balises HTML
    const wordCount = plainText.split(/\s+/).length;
    return Math.ceil(wordCount / wordsPerMinute);
  };

  const readingTime = calculateReadingTime(data?.article_text);

  if (!data) {
    return (
      <section className={styles.errorContainer}>
        <div className={styles.errorContent}>
          <h2>Article non trouvé</h2>
          <p>
            L&apos;article que vous recherchez n&apos;existe pas ou a été
            supprimé.
          </p>
          <Link href="/dashboard/blog" className={styles.backButton}>
            Retour aux articles
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.singleArticleSection}>
      {/* Status Banner */}
      <div
        className={`${styles.statusBanner} ${data.is_active ? styles.statusActive : styles.statusInactive}`}
      >
        <div className={styles.statusInfo}>
          <span className={styles.statusIndicator}>
            {data.is_active ? '🟢' : '🔴'}
          </span>
          <span className={styles.statusText}>
            {data.is_active ? 'Article publié' : 'Article en brouillon'}
          </span>
        </div>
        <button
          onClick={toggleArticleStatus}
          disabled={isLoading}
          className={`${styles.statusToggle} ${data.is_active ? styles.toggleDeactivate : styles.toggleActivate}`}
        >
          {isLoading
            ? '...'
            : data.is_active
              ? 'Mettre en brouillon'
              : 'Publier'}
        </button>
      </div>

      <div
        className={`${styles.postDetailContainer} ${data.is_active ? styles.containerActive : styles.containerInactive}`}
      >
        {/* Header avec métadonnées */}
        <div className={styles.postDetailHeader}>
          <div className={styles.postDetailMeta}>
            <p className={styles.dateWritten}>Publié le {data.created}</p>
            {data.updated !== data.created && (
              <p className={styles.dateUpdated}>Modifié le {data.updated}</p>
            )}
            <div className={styles.readingTime}>
              📖 {readingTime} min de lecture
            </div>
          </div>

          <div className={styles.postDetailActions}>
            <button
              onClick={copyArticleLink}
              className={`${styles.actionButton} ${styles.copyButton} ${copied ? styles.copied : ''}`}
              title="Copier le lien"
            >
              {copied ? '✓ Copié!' : '🔗 Partager'}
            </button>

            <Link
              href={`/dashboard/blog/${data.article_id}/edit`}
              className={`${styles.actionButton} ${styles.editButton}`}
            >
              ✏️ Modifier
            </Link>

            <button
              onClick={() => setShowDeleteConfirm(true)}
              className={`${styles.actionButton} ${styles.deleteButton}`}
              disabled={isLoading}
            >
              🗑️ Supprimer
            </button>
          </div>
        </div>

        {/* Titre avec indicateur de statut */}
        <div className={styles.titleContainer}>
          <h1 className={styles.articleTitle}>{data.article_title}</h1>
          {!data.is_active && (
            <span className={styles.draftBadge}>BROUILLON</span>
          )}
        </div>

        {/* Image avec gestion d'erreur et effet de hover */}
        <div className={styles.postDetailImage}>
          {!imageError ? (
            <CldImage
              priority
              src={data.article_image}
              alt={`Image d'illustration pour ${data.article_title}`}
              width={750}
              height={500}
              style={{ width: '100%', height: 'auto' }}
              onError={() => setImageError(true)}
              className={styles.articleImage}
            />
          ) : (
            <div className={styles.imagePlaceholder}>
              <span>🖼️</span>
              <p>Image non disponible</p>
            </div>
          )}
        </div>

        {/* Contenu de l'article */}
        <article className={styles.postDetailContent}>
          {data.article_text ? (
            parse(data.article_text)
          ) : (
            <p className={styles.noContent}>Aucun contenu disponible.</p>
          )}
        </article>

        {/* Footer avec actions supplémentaires */}
        <div className={styles.postDetailFooter}>
          <div className={styles.footerStats}>
            <span>ID: {data.article_id}</span>
          </div>
          <Link href="/dashboard/blog" className={styles.backToList}>
            ← Retour à la liste
          </Link>
        </div>
      </div>

      {/* Modal de confirmation de suppression */}
      {showDeleteConfirm && (
        <div
          className={styles.modal}
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div
            className={styles.modalContent}
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Confirmer la suppression</h3>
            <p>
              Êtes-vous sûr de vouloir supprimer l&apos;article{' '}
              <strong>&quot;{data.article_title}&quot;</strong> ?
            </p>
            <p className={styles.warningText}>
              ⚠️ Cette action est irréversible.
            </p>
            <div className={styles.modalActions}>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className={styles.cancelButton}
                disabled={isLoading}
              >
                Annuler
              </button>
              <button
                onClick={deleteArticle}
                className={styles.confirmDeleteButton}
                disabled={isLoading}
              >
                {isLoading ? 'Suppression...' : 'Supprimer définitivement'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loader overlay */}
      {isLoading && (
        <div className={styles.loadingOverlay}>
          <div className={styles.spinner}></div>
        </div>
      )}
    </section>
  );
};

export default SingleArticle;
