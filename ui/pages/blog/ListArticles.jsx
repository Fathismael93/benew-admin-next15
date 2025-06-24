'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  MdAdd,
  MdSearch,
  MdViewList,
  MdViewModule,
  MdEdit,
  MdDelete,
  MdVisibility,
  MdVisibilityOff,
  MdRefresh,
} from 'react-icons/md';

import styles from '@/ui/styling/dashboard/blog/blog.module.css';
// import Search from '@/ui/components/dashboard/search';
import PostCard from '@/ui/components/dashboard/PostCard';

const ListArticles = ({ data }) => {
  const [articles, setArticles] = useState(data || []);
  // const [filteredArticles, setFilteredArticles] = useState(data || []);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all'); // 'all', 'active', 'inactive'
  const [sortBy, setSortBy] = useState('newest'); // 'newest', 'oldest', 'title'
  const [viewMode, setViewMode] = useState('grid'); // 'grid', 'list'
  const [isLoading, setIsLoading] = useState(false);
  const [selectedArticles, setSelectedArticles] = useState(new Set());
  const [showBulkActions, setShowBulkActions] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState(null);

  const router = useRouter();

  // Update articles when data prop changes
  useEffect(() => {
    setArticles(data || []);
    // setFilteredArticles(data || []);
  }, [data]);

  // Filter and sort articles
  const processedArticles = useMemo(() => {
    let result = [...articles];

    // Apply search filter
    if (searchTerm) {
      result = result.filter((article) =>
        article.article_title?.toLowerCase().includes(searchTerm.toLowerCase()),
      );
    }

    // Apply status filter
    if (filterStatus !== 'all') {
      result = result.filter((article) => {
        if (filterStatus === 'active') return article.is_active;
        if (filterStatus === 'inactive') return !article.is_active;
        return true;
      });
    }

    // Apply sorting
    result.sort((a, b) => {
      switch (sortBy) {
        case 'newest':
          return new Date(b.created) - new Date(a.created);
        case 'oldest':
          return new Date(a.created) - new Date(b.created);
        case 'title':
          return (a.article_title || '').localeCompare(b.article_title || '');
        default:
          return 0;
      }
    });

    return result;
  }, [articles, searchTerm, filterStatus, sortBy]);

  // Handle search
  const handleSearch = useCallback((term) => {
    setSearchTerm(term);
  }, []);

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
          prev.filter((article) => article.article_id !== articleId),
        );
        setSelectedArticles((prev) => {
          const newSet = new Set(prev);
          newSet.delete(articleId);
          return newSet;
        });

        // Show success message (you could add a toast notification here)
        console.log('Article deleted successfully');
      } else {
        console.error('Failed to delete article');
        // You could add error handling/notification here
      }
    } catch (error) {
      console.error('Error deleting article:', error);
      // You could add error handling/notification here
    } finally {
      setIsLoading(false);
      setDeleteConfirmation(null);
    }
  };

  // Handle bulk selection
  const toggleArticleSelection = (articleId) => {
    setSelectedArticles((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(articleId)) {
        newSet.delete(articleId);
      } else {
        newSet.add(articleId);
      }
      setShowBulkActions(newSet.size > 0);
      return newSet;
    });
  };

  const selectAllArticles = () => {
    if (selectedArticles.size === processedArticles.length) {
      setSelectedArticles(new Set());
      setShowBulkActions(false);
    } else {
      setSelectedArticles(new Set(processedArticles.map((a) => a.article_id)));
      setShowBulkActions(true);
    }
  };

  // Handle refresh
  const handleRefresh = () => {
    setIsLoading(true);
    router.refresh();
    setTimeout(() => setIsLoading(false), 1000);
  };

  // Stats calculation
  const stats = useMemo(() => {
    const total = articles.length;
    const active = articles.filter((a) => a.is_active).length;
    const inactive = total - active;
    return { total, active, inactive };
  }, [articles]);

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
            <MdSearch className={styles.searchIcon} />
            <input
              type="text"
              placeholder="Search articles by title..."
              value={searchTerm}
              onChange={(e) => handleSearch(e.target.value)}
              className={styles.searchInput}
            />
          </div>

          <div className={styles.filters}>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className={styles.filterSelect}
            >
              <option value="all">All Status</option>
              <option value="active">Active Only</option>
              <option value="inactive">Inactive Only</option>
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className={styles.sortSelect}
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="title">Title A-Z</option>
            </select>
          </div>
        </div>

        <div className={styles.viewControls}>
          <div className={styles.bulkSelect}>
            <input
              type="checkbox"
              checked={
                selectedArticles.size === processedArticles.length &&
                processedArticles.length > 0
              }
              onChange={selectAllArticles}
              className={styles.selectAllCheckbox}
            />
            <span className={styles.selectAllLabel}>
              {selectedArticles.size > 0
                ? `${selectedArticles.size} selected`
                : 'Select all'}
            </span>
          </div>

          <div className={styles.viewModeToggle}>
            <button
              className={`${styles.viewModeButton} ${viewMode === 'grid' ? styles.active : ''}`}
              onClick={() => setViewMode('grid')}
              title="Grid view"
            >
              <MdViewModule />
            </button>
            <button
              className={`${styles.viewModeButton} ${viewMode === 'list' ? styles.active : ''}`}
              onClick={() => setViewMode('list')}
              title="List view"
            >
              <MdViewList />
            </button>
          </div>
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {showBulkActions && (
        <div className={styles.bulkActionsBar}>
          <span className={styles.bulkActionsText}>
            {selectedArticles.size} article
            {selectedArticles.size > 1 ? 's' : ''} selected
          </span>
          <div className={styles.bulkActions}>
            <button className={styles.bulkActionButton}>
              <MdVisibility /> Activate
            </button>
            <button className={styles.bulkActionButton}>
              <MdVisibilityOff /> Deactivate
            </button>
            <button className={`${styles.bulkActionButton} ${styles.danger}`}>
              <MdDelete /> Delete
            </button>
          </div>
        </div>
      )}

      {/* Results Info */}
      <div className={styles.resultsInfo}>
        <span className={styles.resultsCount}>
          Showing {processedArticles.length} of {articles.length} articles
        </span>
        {searchTerm && (
          <span className={styles.searchInfo}>
            for &quot;{searchTerm}&quot;
          </span>
        )}
      </div>

      {/* Articles Grid/List */}
      <div className={styles.articlesContainer}>
        {isLoading ? (
          <div className={styles.loading}>
            <div className={styles.loadingSpinner}></div>
            <span>Loading articles...</span>
          </div>
        ) : processedArticles.length > 0 ? (
          <div
            className={`${styles.articlesGrid} ${viewMode === 'list' ? styles.listView : styles.gridView}`}
          >
            {processedArticles.map((article) => (
              <div key={article.article_id} className={styles.articleWrapper}>
                <div className={styles.articleSelection}>
                  <input
                    type="checkbox"
                    checked={selectedArticles.has(article.article_id)}
                    onChange={() => toggleArticleSelection(article.article_id)}
                    className={styles.articleCheckbox}
                  />
                </div>

                <div className={styles.articleCard}>
                  <div className={styles.articleStatus}>
                    {article.is_active ? (
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
                    blog_id={article.article_id}
                    title={article.article_title}
                    picture={article.article_image}
                    created={article.created}
                    updated={article.updated}
                    isActive={article.is_active}
                    deleteArticle={() =>
                      deleteArticle(article.article_id, article.article_image)
                    }
                  />

                  <div className={styles.articleActions}>
                    <Link href={`/dashboard/blog/edit/${article.article_id}`}>
                      <button
                        className={styles.actionButton}
                        title="Edit article"
                      >
                        <MdEdit />
                      </button>
                    </Link>
                    <button
                      className={`${styles.actionButton} ${styles.danger}`}
                      onClick={() =>
                        deleteArticle(article.article_id, article.article_image)
                      }
                      title="Delete article"
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
              {searchTerm || filterStatus !== 'all'
                ? 'No articles found'
                : 'No articles yet'}
            </h3>
            <p className={styles.emptyDescription}>
              {searchTerm || filterStatus !== 'all'
                ? 'Try adjusting your search or filters'
                : 'Start by creating your first blog article'}
            </p>
            {!searchTerm && filterStatus === 'all' && (
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
