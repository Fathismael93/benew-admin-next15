import React from 'react';
import axios from 'axios';
import OrdersList from '@/ui/pages/orders/OrdersList';

async function getOrders() {
  let orders = [];

  // await axios
  //   .get('https://benew-admin-next15.vercel.app/api/dashboard/orders')
  //   .then((response) => {
  //     console.log('REESPONSE IN SERVER COMPONENT OrdersPage');
  //     console.log(response);

  //     orders = response.data.orders;
  //   })
  //   .catch((error) => console.log(error));

  return orders;
}

const OrdersPage = async () => {
  const orders = await getOrders();

  return <OrdersList data={orders} />;
};

export default OrdersPage;
