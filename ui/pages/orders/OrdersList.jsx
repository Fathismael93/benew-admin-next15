/* eslint-disable no-unused-vars */
'use client';

import { useState, useMemo, useTransition } from 'react';
import { CldImage } from 'next-cloudinary';
import Link from 'next/link';
import {
  MdTrendingUp,
  MdShoppingCart,
  MdPending,
  MdCheckCircle,
  MdRefresh,
  MdError,
  MdUndo,
  MdVisibility,
  MdArrowForward,
  MdWarning,
  MdClose,
} from 'react-icons/md';
import styles from '@/ui/styling/dashboard/orders/orders.module.css';
import OrderSearch from '@/ui/components/dashboard/search/OrderSearch';
import OrderFilters from '@/ui/components/dashboard/OrderFilters';
import { getFilteredOrders } from '@/app/dashboard/orders/actions';
import { updateOrderPaymentStatus } from '@app/dashboard/orders/actions';

const OrdersList = ({ data, totalOrders }) => {
  const [orders, setOrders] = useState(data);
  const [statusUpdateLoading, setStatusUpdateLoading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [currentFilters, setCurrentFilters] = useState({});
  const [error, setError] = useState(null);
  const [statusUpdateError, setStatusUpdateError] = useState(null);

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

  // Fonction pour fermer les erreurs
  const dismissError = () => setError(null);
  const dismissStatusError = () => setStatusUpdateError(null);

  // Fonction utilisant l'API route pour la mise à jour du statut
  const handleStatusChange = async (orderId, newStatus) => {
    setStatusUpdateLoading(true);
    setStatusUpdateError(null);

    // Sauvegarder l'état actuel pour le rollback
    const previousOrders = [...orders];

    try {
      // Optimistic update pour une meilleure UX
      setOrders((prevOrders) =>
        prevOrders.map((order) =>
          order.order_id === orderId
            ? { ...order, order_payment_status: newStatus }
            : order,
        ),
      );

      // PAR ÇA :
      const result = await updateOrderPaymentStatus(orderId, newStatus);

      if (!result.success) {
        throw new Error(`Erreur ${result.status}: ${result.statusText}`);
      }

      // Succès confirmé côté serveur
    } catch (error) {
      // Rollback en cas d'erreur
      setOrders(previousOrders);
      setStatusUpdateError(
        `Impossible de mettre à jour le statut de la commande #${orderId}. ${error.message}`,
      );
    } finally {
      setStatusUpdateLoading(false);
    }
  };

  // Fonction pour gérer les changements de filtres
  const handleFilterChange = async (newFilters) => {
    setCurrentFilters(newFilters);
    setError(null);

    startTransition(async () => {
      try {
        const result = await getFilteredOrders(newFilters);

        if (result && result.orders) {
          setOrders(result.orders);
        }
      } catch (error) {
        setError(
          'Une erreur est survenue lors du filtrage des commandes. Veuillez réessayer.',
        );
      }
    });
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

  // Vérifier si on a des filtres actifs
  const hasActiveFilters = Object.keys(currentFilters).length > 0;

  return (
    <div className={styles.container}>
      {/* Notifications d'erreur */}
      {error && (
        <div className={styles.errorNotification}>
          <MdWarning className={styles.errorIcon} />
          <span className={styles.errorMessage}>{error}</span>
          <button
            onClick={dismissError}
            className={styles.errorDismiss}
            aria-label="Fermer la notification"
          >
            <MdClose />
          </button>
        </div>
      )}

      {statusUpdateError && (
        <div className={styles.errorNotification}>
          <MdWarning className={styles.errorIcon} />
          <span className={styles.errorMessage}>{statusUpdateError}</span>
          <button
            onClick={dismissStatusError}
            className={styles.errorDismiss}
            aria-label="Fermer la notification"
          >
            <MdClose />
          </button>
        </div>
      )}

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
            <OrderSearch
              placeholder="Rechercher par nom ou prénom du client..."
              onFilterChange={handleFilterChange}
              currentFilters={currentFilters}
            />
          </div>
        </div>

        <div className={styles.filtersSection}>
          <OrderFilters
            onFilterChange={handleFilterChange}
            currentFilters={currentFilters}
          />
        </div>
      </div>

      {/* Indicateur de chargement pour les filtres */}
      {isPending && (
        <div className={styles.loadingIndicator}>
          <MdRefresh className={styles.loadingIcon} />
          <span>Filtrage en cours...</span>
        </div>
      )}

      {/* Résultats */}
      <div className={styles.resultsHeader}>
        <span className={styles.resultsCount}>
          {orders.length} commande{orders.length > 1 ? 's' : ''}
          {hasActiveFilters && ' trouvée(s) avec les filtres appliqués'}
        </span>
      </div>

      {/* Liste des commandes */}
      <div className={styles.ordersList}>
        {orders.length > 0 ? (
          <div className={styles.ordersGrid}>
            {orders.map((order) => (
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
                      {order.application_images &&
                      order.application_images.length > 0 ? (
                        <CldImage
                          src={order.application_images[0]}
                          alt={order.application_name}
                          width={80}
                          height={80}
                          className={styles.orderImage}
                        />
                      ) : (
                        <div className={styles.noImage}>
                          <MdShoppingCart />
                        </div>
                      )}
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
                      disabled={statusUpdateLoading}
                      className={`${styles.statusButton} ${styles[`statusButton${order.order_payment_status.charAt(0).toUpperCase() + order.order_payment_status.slice(1)}`]}`}
                      aria-label={`${getStatusActionText(order.order_payment_status)} pour la commande ${order.order_id}`}
                    >
                      {statusUpdateLoading ? (
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
                      disabled={statusUpdateLoading}
                      className={styles.statusSelect}
                      aria-label={`Changer le statut de la commande ${order.order_id}`}
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
              {hasActiveFilters ? 'Aucune commande trouvée' : 'Aucune commande'}
            </h3>
            <p className={styles.emptyDescription}>
              {hasActiveFilters
                ? 'Aucune commande ne correspond aux filtres appliqués'
                : "Il n'y a pas encore de commandes à afficher."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default OrdersList;
