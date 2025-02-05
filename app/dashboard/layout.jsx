import styles from '@/ui/styling/dashboard/dashboard.module.css';
import Navbar from '@/ui/components/dashboard/navbar';
import Sidebar from '@/ui/components/dashboard/sidebar';

function Layout({ children }) {
  return (
    <div className={styles.container}>
      <div className={styles.menu}>
        <Sidebar />
      </div>
      <div className={styles.content}>
        <Navbar />
        {children}
      </div>
    </div>
  );
}

export default Layout;
