'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  MdAdd,
  MdEdit,
  MdDelete,
  MdVisibility,
  MdVisibilityOff,
  MdRefresh,
} from 'react-icons/md';

import styles from '@/ui/styling/dashboard/blog/blog.module.css';
import PostCard from '@/ui/components/dashboard/PostCard';
import BlogSearch from '@ui/components/dashboard/search/BlogSearch';
import { getFilteredArticles } from '@/app/dashboard/blog/actions';

const ListArticles = ({ data: initialData }) => {
  const [articles, setArticles] = useState(initialData || []);
  const [filters, setFilters] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState(null);

  const router = useRouter();

  // Update articles when data prop changes
  useEffect(() => {
    setArticles(initialData || []);
  }, [initialData]);

  // Fonction pour gérer les changements de filtres
  const handleFiltersChange = useCallback(
    async (newFilters) => {
      setFilters(newFilters);
      setIsLoading(true);

      try {
        const filteredData = await getFilteredArticles(newFilters);
        setArticles(filteredData);
      } catch (error) {
        console.error('Erreur lors du filtrage des articles:', error);
        // En cas d'erreur, revenir aux données initiales
        setArticles(initialData);
      } finally {
        setIsLoading(false);
      }
    },
    [initialData],
  );

  // Fonction pour gérer le changement de statut via select
  const handleStatusFilterChange = useCallback(
    (status) => {
      const newFilters = {
        ...filters,
      };

      if (status === 'all') {
        // Si "all" est sélectionné, supprimer le filtre is_active
        delete newFilters.is_active;
      } else {
        // Sinon, ajouter le filtre approprié
        newFilters.is_active = [status === 'active' ? 'true' : 'false'];
      }

      handleFiltersChange(newFilters);
    },
    [filters, handleFiltersChange],
  );

  // Handle article deletion
  const deleteArticle = async (articleId, articleImage) => {
    if (!deleteConfirmation) {
      setDeleteConfirmation({ articleId, articleImage });
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`/api/dashboard/blog/${articleId}/delete`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ imageID: articleImage }),
      });

      if (response.ok) {
        // Remove article from local state
        setArticles((prev) =>
          prev.filter((article) => article.articleId !== articleId),
        );

        // Show success message
        console.log('Article deleted successfully');
      } else {
        console.error('Failed to delete article');
      }
    } catch (error) {
      console.error('Error deleting article:', error);
    } finally {
      setIsLoading(false);
      setDeleteConfirmation(null);
    }
  };

  // Handle refresh
  const handleRefresh = useCallback(() => {
    setIsLoading(true);
    // Reset filters and reload initial data
    setFilters({});
    setArticles(initialData);
    router.refresh();
    setTimeout(() => setIsLoading(false), 1000);
  }, [router, initialData]);

  // Stats calculation
  const stats = useMemo(() => {
    const total = articles.length;
    const active = articles.filter((a) => a.isActive).length;
    const inactive = total - active;
    return { total, active, inactive };
  }, [articles]);

  // Dériver le statut actuel du filtre pour le select
  const currentFilterStatus = useMemo(() => {
    if (!filters.is_active || filters.is_active.length === 0) {
      return 'all';
    }
    if (filters.is_active.includes('true')) {
      return 'active';
    }
    if (filters.is_active.includes('false')) {
      return 'inactive';
    }
    return 'all';
  }, [filters.is_active]);

  return (
    <div className={styles.container}>
      {/* Header Section */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.pageTitle}>Blog Articles</h1>
          <div className={styles.stats}>
            <span className={styles.statItem}>
              <span className={styles.statNumber}>{stats.total}</span>
              <span className={styles.statLabel}>Total</span>
            </span>
            <span className={styles.statItem}>
              <span className={`${styles.statNumber} ${styles.active}`}>
                {stats.active}
              </span>
              <span className={styles.statLabel}>Active</span>
            </span>
            <span className={styles.statItem}>
              <span className={`${styles.statNumber} ${styles.inactive}`}>
                {stats.inactive}
              </span>
              <span className={styles.statLabel}>Inactive</span>
            </span>
          </div>
        </div>
        <div className={styles.headerRight}>
          <button
            className={styles.refreshButton}
            onClick={handleRefresh}
            disabled={isLoading}
            title="Refresh articles"
          >
            <MdRefresh className={isLoading ? styles.spinning : ''} />
          </button>
          <Link href="/dashboard/blog/add">
            <button className={styles.addButton} type="button">
              <MdAdd />
              <span>New Article</span>
            </button>
          </Link>
        </div>
      </div>

      {/* Controls Section */}
      <div className={styles.controls}>
        <div className={styles.searchAndFilters}>
          <div className={styles.searchWrapper}>
            <BlogSearch
              placeholder="Search for an article..."
              onFilterChange={handleFiltersChange}
              currentFilters={filters}
            />
            {isLoading && <div className={styles.loading}>Searching...</div>}
          </div>

          <div className={styles.filters}>
            <select
              value={currentFilterStatus}
              onChange={(e) => handleStatusFilterChange(e.target.value)}
              className={styles.filterSelect}
              disabled={isLoading}
            >
              <option value="all">All Status</option>
              <option value="active">Active Only</option>
              <option value="inactive">Inactive Only</option>
            </select>
          </div>
        </div>
      </div>

      {/* Results Info */}
      <div className={styles.resultsInfo}>
        <span className={styles.resultsCount}>
          Showing {articles.length} articles
        </span>
        {filters.article_name && (
          <span className={styles.searchInfo}>
            for &quot;{filters.article_name}&quot;
          </span>
        )}
        {currentFilterStatus !== 'all' && (
          <span className={styles.searchInfo}>
            ({currentFilterStatus} only)
          </span>
        )}
      </div>

      {/* Articles Grid */}
      <div className={styles.articlesContainer}>
        {isLoading ? (
          <div className={styles.loading}>
            <div className={styles.loadingSpinner}></div>
            <span>Loading articles...</span>
          </div>
        ) : articles.length > 0 ? (
          <div className={`${styles.articlesGrid} ${styles.gridView}`}>
            {articles.map((article) => (
              <div key={article.articleId} className={styles.articleWrapper}>
                <div className={styles.articleCard}>
                  <div className={styles.articleStatus}>
                    {article.isActive ? (
                      <span
                        className={`${styles.statusBadge} ${styles.active}`}
                      >
                        <MdVisibility /> Active
                      </span>
                    ) : (
                      <span
                        className={`${styles.statusBadge} ${styles.inactive}`}
                      >
                        <MdVisibilityOff /> Inactive
                      </span>
                    )}
                  </div>

                  <PostCard
                    blog_id={article.articleId}
                    title={article.articleTitle}
                    picture={article.articleImage}
                    created={article.created}
                    updated={article.updated}
                    isActive={article.isActive}
                    deleteArticle={() =>
                      deleteArticle(article.articleId, article.articleImage)
                    }
                  />

                  <div className={styles.articleActions}>
                    <Link href={`/dashboard/blog/edit/${article.articleId}`}>
                      <button
                        className={styles.actionButton}
                        title="Edit article"
                      >
                        <MdEdit />
                      </button>
                    </Link>
                    <button
                      className={`${styles.actionButton} ${styles.danger} ${
                        article.isActive ? styles.disabled : ''
                      }`}
                      onClick={() =>
                        !article.isActive &&
                        deleteArticle(article.articleId, article.articleImage)
                      }
                      disabled={article.isActive}
                      title={
                        article.isActive
                          ? 'Cannot delete active article. Please deactivate first.'
                          : 'Delete article'
                      }
                    >
                      <MdDelete />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>📝</div>
            <h3 className={styles.emptyTitle}>
              {filters.article_name || currentFilterStatus !== 'all'
                ? 'No articles found'
                : 'No articles yet'}
            </h3>
            <p className={styles.emptyDescription}>
              {filters.article_name || currentFilterStatus !== 'all'
                ? 'Try adjusting your search or filters'
                : 'Start by creating your first blog article'}
            </p>
            {!filters.article_name && currentFilterStatus === 'all' && (
              <Link href="/dashboard/blog/add">
                <button className={styles.emptyActionButton}>
                  <MdAdd /> Create First Article
                </button>
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirmation && (
        <div className={styles.modal}>
          <div className={styles.modalContent}>
            <h3 className={styles.modalTitle}>Delete Article</h3>
            <p className={styles.modalText}>
              Are you sure you want to delete this article? This action cannot
              be undone.
            </p>
            <div className={styles.modalActions}>
              <button
                className={styles.modalCancelButton}
                onClick={() => setDeleteConfirmation(null)}
              >
                Cancel
              </button>
              <button
                className={styles.modalDeleteButton}
                onClick={() =>
                  deleteArticle(
                    deleteConfirmation.articleId,
                    deleteConfirmation.articleImage,
                  )
                }
              >
                Delete Article
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ListArticles;
