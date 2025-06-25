import axios from 'axios';
import EditOrder from '@ui/pages/orders/EditOrder';

async function getSingleOrder(id) {
  let data;

  await axios
    .get(`https://benew-admin-next15.vercel.app/api/dashboard/orders/${id}`)
    .then((response) => {
      console.log('response :', response);
      data = response.data.data.order;
    })
    .catch((e) => {
      console.log(e);
    });

  return data;
}

const EditOrderPage = async ({ params }) => {
  const { id } = await params;

  const data = await getSingleOrder(id);

  return <EditOrder order={data} />;
};

export default EditOrderPage;
