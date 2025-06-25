/* eslint-disable no-unused-vars */
'use client';

import { useState, useMemo } from 'react';
import { CldImage } from 'next-cloudinary';
import Link from 'next/link';
import {
  MdFilterList,
  MdSort,
  MdTrendingUp,
  MdShoppingCart,
  MdPending,
  MdCheckCircle,
  MdRefresh,
  MdError,
  MdUndo,
  MdVisibility,
  MdArrowForward,
} from 'react-icons/md';
import styles from '@/ui/styling/dashboard/orders/orders.module.css';
import Search from '@/ui/components/dashboard/search';

const OrdersList = ({ data, totalOrders }) => {
  const [orders, setOrders] = useState(data);
  const [filteredOrders, setFilteredOrders] = useState(data);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('created_desc');
  const [loading, setLoading] = useState(false);

  // Statistiques calculées avec les 4 statuts
  const stats = useMemo(() => {
    const totalRevenue = orders.reduce(
      (sum, order) => sum + order.order_price,
      0,
    );
    const paidOrders = orders.filter(
      (order) => order.order_payment_status === 'paid',
    ).length;
    const unpaidOrders = orders.filter(
      (order) => order.order_payment_status === 'unpaid',
    ).length;
    const refundedOrders = orders.filter(
      (order) => order.order_payment_status === 'refunded',
    ).length;
    const failedOrders = orders.filter(
      (order) => order.order_payment_status === 'failed',
    ).length;

    return {
      totalRevenue,
      paidOrders,
      unpaidOrders,
      refundedOrders,
      failedOrders,
    };
  }, [orders]);

  // Filtrage et tri des commandes
  useMemo(() => {
    let filtered = [...orders];

    // Filtrer par terme de recherche
    if (searchTerm) {
      filtered = filtered.filter(
        (order) =>
          order.application_name
            .toLowerCase()
            .includes(searchTerm.toLowerCase()) ||
          order.order_id.toString().includes(searchTerm) ||
          order.application_category
            .toLowerCase()
            .includes(searchTerm.toLowerCase()),
      );
    }

    // Filtrer par statut
    if (statusFilter !== 'all') {
      filtered = filtered.filter((order) => {
        return order.order_payment_status === statusFilter;
      });
    }

    // Trier
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'created_desc':
          return new Date(b.order_created) - new Date(a.order_created);
        case 'created_asc':
          return new Date(a.order_created) - new Date(b.order_created);
        case 'price_desc':
          return b.order_price - a.order_price;
        case 'price_asc':
          return a.order_price - b.order_price;
        case 'name_asc':
          return a.application_name.localeCompare(b.application_name);
        case 'name_desc':
          return b.application_name.localeCompare(a.application_name);
        default:
          return 0;
      }
    });

    setFilteredOrders(filtered);
  }, [orders, searchTerm, statusFilter, sortBy]);

  const handleStatusChange = async (orderId, newStatus) => {
    setLoading(true);

    try {
      const response = await fetch('/api/dashboard/orders/update-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ orderId, order_payment_status: newStatus }),
      });

      if (response.ok) {
        setOrders((prevOrders) =>
          prevOrders.map((order) =>
            order.order_id === orderId
              ? { ...order, order_payment_status: newStatus }
              : order,
          ),
        );
      } else {
        throw new Error('Failed to update status');
      }
    } catch (error) {
      console.error('Error updating payment status:', error);
      // TODO: Ajouter une notification d'erreur
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'paid':
        return <MdCheckCircle className={styles.statusIconPaid} />;
      case 'unpaid':
        return <MdPending className={styles.statusIconPending} />;
      case 'refunded':
        return <MdUndo className={styles.statusIconRefunded} />;
      case 'failed':
        return <MdError className={styles.statusIconFailed} />;
      default:
        return <MdPending className={styles.statusIconPending} />;
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'paid':
        return 'Payée';
      case 'unpaid':
        return 'En attente';
      case 'refunded':
        return 'Remboursée';
      case 'failed':
        return 'Échouée';
      default:
        return 'En attente';
    }
  };

  const getStatusClass = (status) => {
    switch (status) {
      case 'paid':
        return styles.statusPaid;
      case 'unpaid':
        return styles.statusPending;
      case 'refunded':
        return styles.statusRefunded;
      case 'failed':
        return styles.statusFailed;
      default:
        return styles.statusPending;
    }
  };

  const getNextStatus = (currentStatus) => {
    switch (currentStatus) {
      case 'unpaid':
        return 'paid';
      case 'paid':
        return 'refunded';
      case 'refunded':
        return 'unpaid';
      case 'failed':
        return 'unpaid';
      default:
        return 'paid';
    }
  };

  const getStatusActionText = (currentStatus) => {
    switch (currentStatus) {
      case 'unpaid':
        return 'Marquer comme payée';
      case 'paid':
        return 'Marquer comme remboursée';
      case 'refunded':
        return 'Marquer comme impayée';
      case 'failed':
        return 'Marquer comme impayée';
      default:
        return 'Changer le statut';
    }
  };

  const formatPrice = (price) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
    }).format(price);
  };

  const formatDate = (dateString) => {
    return new Intl.DateTimeFormat('fr-FR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(dateString));
  };

  return (
    <div className={styles.container}>
      {/* En-tête avec statistiques */}
      <div className={styles.header}>
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <div className={styles.statIcon}>
              <MdShoppingCart />
            </div>
            <div className={styles.statContent}>
              <span className={styles.statValue}>{totalOrders}</span>
              <span className={styles.statLabel}>Total Commandes</span>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={styles.statIcon}>
              <MdTrendingUp />
            </div>
            <div className={styles.statContent}>
              <span className={styles.statValue}>
                {formatPrice(stats.totalRevenue)}
              </span>
              <span className={styles.statLabel}>Revenus Total</span>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={styles.statIcon}>
              <MdCheckCircle />
            </div>
            <div className={styles.statContent}>
              <span className={styles.statValue}>{stats.paidOrders}</span>
              <span className={styles.statLabel}>Payées</span>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={styles.statIcon}>
              <MdPending />
            </div>
            <div className={styles.statContent}>
              <span className={styles.statValue}>{stats.unpaidOrders}</span>
              <span className={styles.statLabel}>En Attente</span>
            </div>
          </div>

          {(stats.refundedOrders > 0 || stats.failedOrders > 0) && (
            <>
              <div className={styles.statCard}>
                <div className={styles.statIcon}>
                  <MdUndo />
                </div>
                <div className={styles.statContent}>
                  <span className={styles.statValue}>
                    {stats.refundedOrders}
                  </span>
                  <span className={styles.statLabel}>Remboursées</span>
                </div>
              </div>

              <div className={styles.statCard}>
                <div className={styles.statIcon}>
                  <MdError />
                </div>
                <div className={styles.statContent}>
                  <span className={styles.statValue}>{stats.failedOrders}</span>
                  <span className={styles.statLabel}>Échouées</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Barre d'outils */}
      <div className={styles.toolbar}>
        <div className={styles.searchSection}>
          <div className={styles.searchWrapper}>
            <Search
              placeholder="Rechercher une commande, produit..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className={styles.filtersSection}>
          <div className={styles.filterGroup}>
            <MdFilterList className={styles.filterIcon} />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={styles.filterSelect}
            >
              <option value="all">Tous les statuts</option>
              <option value="paid">Payées</option>
              <option value="unpaid">En attente</option>
              <option value="refunded">Remboursées</option>
              <option value="failed">Échouées</option>
            </select>
          </div>

          <div className={styles.filterGroup}>
            <MdSort className={styles.filterIcon} />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className={styles.filterSelect}
            >
              <option value="created_desc">Plus récent</option>
              <option value="created_asc">Plus ancien</option>
              <option value="price_desc">Prix décroissant</option>
              <option value="price_asc">Prix croissant</option>
              <option value="name_asc">Nom A-Z</option>
              <option value="name_desc">Nom Z-A</option>
            </select>
          </div>
        </div>
      </div>

      {/* Résultats */}
      <div className={styles.resultsHeader}>
        <span className={styles.resultsCount}>
          {filteredOrders.length} commande{filteredOrders.length > 1 ? 's' : ''}
          {searchTerm &&
            ` trouvée${filteredOrders.length > 1 ? 's' : ''} pour "${searchTerm}"`}
        </span>
      </div>

      {/* Liste des commandes */}
      <div className={styles.ordersList}>
        {filteredOrders.length > 0 ? (
          <div className={styles.ordersGrid}>
            {filteredOrders.map((order) => (
              <div key={order.order_id} className={styles.orderCard}>
                <div className={styles.orderHeader}>
                  <div className={styles.orderMeta}>
                    <span className={styles.orderId}>#{order.order_id}</span>
                    <span className={styles.orderDate}>
                      {formatDate(order.order_created)}
                    </span>
                  </div>
                  <div
                    className={`${styles.orderStatus} ${getStatusClass(order.order_payment_status)}`}
                  >
                    {getStatusIcon(order.order_payment_status)}
                    <span className={styles.statusText}>
                      {getStatusText(order.order_payment_status)}
                    </span>
                  </div>
                </div>

                <div className={styles.orderBody}>
                  <div className={styles.productSection}>
                    <div className={styles.productImage}>
                      <CldImage
                        src={order.application_images[0]}
                        alt={order.application_name}
                        width={80}
                        height={80}
                        className={styles.orderImage}
                      />
                    </div>
                    <div className={styles.productInfo}>
                      <h3 className={styles.productName}>
                        {order.application_name}
                      </h3>
                      <p className={styles.productCategory}>
                        {order.application_category}
                      </p>
                      <div className={styles.productPrice}>
                        {formatPrice(order.order_price)}
                      </div>
                    </div>
                  </div>
                </div>

                <div className={styles.orderActions}>
                  <div className={styles.actionButtons}>
                    {/* Bouton pour voir les détails */}
                    <Link
                      href={`/dashboard/orders/${order.order_id}`}
                      className={styles.detailsButton}
                    >
                      <MdVisibility />
                      <span>Voir détails</span>
                      <MdArrowForward className={styles.arrowIcon} />
                    </Link>

                    {/* Bouton pour changer le statut */}
                    <button
                      onClick={() =>
                        handleStatusChange(
                          order.order_id,
                          getNextStatus(order.order_payment_status),
                        )
                      }
                      disabled={loading}
                      className={`${styles.statusButton} ${styles[`statusButton${order.order_payment_status.charAt(0).toUpperCase() + order.order_payment_status.slice(1)}`]}`}
                    >
                      {loading ? (
                        <>
                          <MdRefresh className={styles.loadingIcon} />
                          <span>Mise à jour...</span>
                        </>
                      ) : (
                        <>
                          {getStatusIcon(
                            getNextStatus(order.order_payment_status),
                          )}
                          <span>
                            {getStatusActionText(order.order_payment_status)}
                          </span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Dropdown pour changer vers n'importe quel statut */}
                  <div className={styles.statusDropdown}>
                    <select
                      value={order.order_payment_status}
                      onChange={(e) =>
                        handleStatusChange(order.order_id, e.target.value)
                      }
                      disabled={loading}
                      className={styles.statusSelect}
                    >
                      <option value="unpaid">En attente</option>
                      <option value="paid">Payée</option>
                      <option value="refunded">Remboursée</option>
                      <option value="failed">Échouée</option>
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>
              <MdShoppingCart />
            </div>
            <h3 className={styles.emptyTitle}>
              {searchTerm ? 'Aucune commande trouvée' : 'Aucune commande'}
            </h3>
            <p className={styles.emptyDescription}>
              {searchTerm
                ? `Aucune commande ne correspond à "${searchTerm}"`
                : "Il n'y a pas encore de commandes à afficher."}
            </p>
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className={styles.clearSearchBtn}
              >
                Effacer la recherche
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default OrdersList;
