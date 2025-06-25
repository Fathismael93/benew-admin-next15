'use client';

import { useState, useMemo } from 'react';
import { CldImage } from 'next-cloudinary';
import {
  MdFilterList,
  MdSort,
  MdTrendingUp,
  MdShoppingCart,
  MdPending,
  MdCheckCircle,
  MdRefresh,
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

  // Statistiques calculées
  const stats = useMemo(() => {
    const totalRevenue = orders.reduce(
      (sum, order) => sum + order.order_price,
      0,
    );
    const paidOrders = orders.filter(
      (order) => order.order_payment_status,
    ).length;
    const unpaidOrders = orders.length - paidOrders;
    const averageOrder = orders.length > 0 ? totalRevenue / orders.length : 0;

    return {
      totalRevenue,
      paidOrders,
      unpaidOrders,
      averageOrder,
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
        if (statusFilter === 'paid') return order.order_payment_status;
        if (statusFilter === 'unpaid') return !order.order_payment_status;
        return true;
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

  const handleStatusChange = async (orderId, currentStatus) => {
    setLoading(true);
    const updatedStatus = !currentStatus;

    try {
      const response = await fetch('/api/dashboard/orders/update-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ orderId, order_payment_status: updatedStatus }),
      });

      if (response.ok) {
        setOrders((prevOrders) =>
          prevOrders.map((order) =>
            order.order_id === orderId
              ? { ...order, order_payment_status: updatedStatus }
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
    return status ? (
      <MdCheckCircle className={styles.statusIconPaid} />
    ) : (
      <MdPending className={styles.statusIconPending} />
    );
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
              <option value="processing">En cours</option>
              <option value="refunded">Rembourses</option>
              <option value="failed">Echoue</option>
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
                  <div className={styles.orderStatus}>
                    {getStatusIcon(order.order_payment_status)}
                    <span
                      className={`${styles.statusText} ${
                        order.order_payment_status
                          ? styles.statusPaid
                          : styles.statusPending
                      }`}
                    >
                      {order.order_payment_status ? 'Payée' : 'En attente'}
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
                  <label className={styles.statusToggle}>
                    <input
                      type="checkbox"
                      checked={order.order_payment_status}
                      onChange={() =>
                        handleStatusChange(
                          order.order_id,
                          order.order_payment_status,
                        )
                      }
                      disabled={loading}
                      className={styles.statusCheckbox}
                    />
                    <span className={styles.statusSlider}></span>
                    <span className={styles.statusLabel}>
                      {loading ? (
                        <MdRefresh className={styles.loadingIcon} />
                      ) : order.order_payment_status ? (
                        'Marquer comme impayée'
                      ) : (
                        'Marquer comme payée'
                      )}
                    </span>
                  </label>
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
