'use client';

import React, { useState } from 'react';
import { CldImage } from 'next-cloudinary';
import styles from '@/ui/styling/dashboard/orders/orders.module.css';
import Search from '@/ui/components/dashboard/search';

const OrdersList = ({ data }) => {
  const [orders, setOrders] = useState(data);

  const handleStatusChange = async (orderId, currentStatus) => {
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
      }
    } catch (error) {
      console.error('Error updating payment status:', error);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.top}>
        <Search placeholder="Search for an order..." />
      </div>
      <div className={styles.bottom}>
        {orders.length > 0 ? (
          <div className={styles.orderList}>
            {orders.map((order) => (
              <div key={order.order_id} className={styles.orderItem}>
                <CldImage
                  src={order.application_images[0]}
                  alt={order.application_name}
                  width={60}
                  height={60}
                  className={styles.orderImage}
                />
                <div className={styles.orderDetails}>
                  <h3 className={styles.orderTitle}>
                    {order.application_name}
                  </h3>
                  <p className={styles.orderCategory}>
                    {order.application_category}
                  </p>
                  <p className={styles.orderPrice}>
                    Price: ${order.order_price}
                  </p>
                  <label className={styles.orderStatus}>
                    <input
                      type="checkbox"
                      checked={order.order_payment_status}
                      onChange={() =>
                        handleStatusChange(
                          order.order_id,
                          order.order_payment_status,
                        )
                      }
                    />
                    {order.order_payment_status ? 'Paid' : 'Unpaid'}
                  </label>
                  <p className={styles.orderDate}>
                    Created on:{' '}
                    {new Date(order.order_created).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.noOrders}>No orders available.</p>
        )}
      </div>
    </div>
  );
};

export default OrdersList;
