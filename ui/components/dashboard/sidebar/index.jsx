'use client';

import {
  MdDashboard,
  MdSupervisedUserCircle,
  MdShoppingBag,
  MdAttachMoney,
  MdLogout,
} from 'react-icons/md';
import Image from 'next/image';
import MenuLink from './menuLink';
import styles from './sidebar.module.css';
import { signOut } from 'next-auth/react';

const menuItems = [
  {
    title: 'Pages',
    list: [
      {
        title: 'Dashboard',
        path: '/dashboard',
        icon: <MdDashboard />,
      },
      {
        title: 'Templates',
        path: '/dashboard/templates',
        icon: <MdShoppingBag />,
      },
      {
        title: 'Applications',
        path: '/dashboard/applications',
        icon: <MdShoppingBag />,
      },
      {
        title: 'Orders',
        path: '/dashboard/orders',
        icon: <MdAttachMoney />,
      },
      {
        title: 'Blog',
        path: '/dashboard/blog',
        icon: <MdShoppingBag />,
      },
      {
        title: 'Users',
        path: '/dashboard/users',
        icon: <MdSupervisedUserCircle />,
      },
    ],
  },
];

function Sidebar() {
  const logoutHandler = () => {
    signOut();
  };

  return (
    <div className={styles.container}>
      <div className={styles.user}>
        <Image
          className={styles.userImage}
          src="/noavatar.png"
          alt=""
          width="50"
          height="50"
        />
        <div className={styles.userDetail}>
          <span className={styles.username}>Fathi Ahmed</span>
          <span className={styles.userTitle}>Benew founder</span>
        </div>
      </div>
      <ul className={styles.list}>
        {menuItems.map((cat) => (
          <li key={cat.title}>
            <span className={styles.cat}>{cat.title}</span>
            {cat.list.map((item) => (
              <MenuLink item={item} key={item.title} />
            ))}
          </li>
        ))}
      </ul>
      <form>
        <button className={styles.logout} type="button" onClick={logoutHandler}>
          <MdLogout />
          Logout
        </button>
      </form>
    </div>
  );
}

export default Sidebar;
