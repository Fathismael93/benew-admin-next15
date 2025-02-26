'use client';

import React from 'react';

const OrdersList = ({ data }) => {
  console.log('Orders received from api');
  console.log(data);
  return <div>OrdersList</div>;
};

export default OrdersList;
