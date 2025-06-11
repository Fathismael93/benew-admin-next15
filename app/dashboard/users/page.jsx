import ListUsers from '@/ui/pages/users/ListUsers';

async function getUsers() {
  let users = [];

  // await axios
  //   .get('https://benew-admin-next15.vercel.app/api/dashboard/users')
  //   .then((response) => {
  //     users = response.data.users;
  //   })
  //   .catch((error) => console.log(error));

  return users;
}

async function UsersPage() {
  const users = await getUsers();

  return <ListUsers users={users} />;
}

export default UsersPage;
