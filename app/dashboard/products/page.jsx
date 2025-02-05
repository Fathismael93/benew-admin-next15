'use client';

import { React, useEffect, useState } from 'react';
import axios from 'axios';
import { CldImage } from 'next-cloudinary';
import Link from 'next/link';
import { MdAdd } from 'react-icons/md';
import styles from '@/ui/styling/dashboard/products/products.module.css';
import Search from '@/ui/components/dashboard/search';

function ProductsPage() {
  // eslint-disable-next-line no-unused-vars
  const [products, setProducts] = useState('');

  useEffect(() => {
    async function getProducts() {
      await axios
        .get('/api/dashboard/products')
        .then((response) => console.log(response.data.data.rows))
        .catch((error) => console.error(error));
    }

    getProducts();
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.top}>
        <Search placeholder="Search for a product..." />
        <Link href="/dashboard/products/add">
          <button className={styles.addButton} type="button">
            <MdAdd /> Product
          </button>
        </Link>
      </div>
      <div className={styles.presentationsContainer}>
        {products.length > 0
          ? products.map(
              ({
                // eslint-disable-next-line camelcase
                product_id,
              }) => {
                return (
                  // eslint-disable-next-line camelcase
                  <div key={product_id}>
                    <div>
                      <CldImage />
                    </div>
                  </div>
                );
              },
            )
          : ''}
      </div>
    </div>
  );
}

export default ProductsPage;
