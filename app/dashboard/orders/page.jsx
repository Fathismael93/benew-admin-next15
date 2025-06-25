import OrdersList from '@/ui/pages/orders/OrdersList';
import axios from 'axios';

async function getOrders() {
  let orders, totalOrders;

  await axios
    .get('https://benew-admin-next15.vercel.app/api/dashboard/orders')
    .then((response) => {
      console.log('Orders fetched successfully:', response);
      orders = response.data.orders;
      totalOrders = response.data.count;
    })
    .catch((error) => console.log(error));

  return { orders, totalOrders };
}

const OrdersPage = async () => {
  const { orders, totalOrders } = await getOrders();

  return <OrdersList data={orders} total={totalOrders} />;
};

export default OrdersPage;
