'use client';

import React from 'react';
import { CldImage } from 'next-cloudinary';
import styles from '@/ui/styling/dashboard/orders/orders.module.css';
import Search from '@/ui/components/dashboard/search';

const OrdersList = ({ data }) => {
  return (
    <div className={styles.container}>
      <div className={styles.top}>
        <Search placeholder="Search for an order..." />
      </div>
      <div className={styles.bottom}>
        {data.length > 0 ? (
          <div className={styles.orderList}>
            {data.map((order) => (
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
                  <p className={styles.orderStatus}>
                    Status:{' '}
                    <span
                      className={
                        order.order_payment_status ? styles.paid : styles.unpaid
                      }
                    >
                      {order.order_payment_status ? 'Paid' : 'Unpaid'}
                    </span>
                  </p>
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
