'use client';

import styles from '.@/ui/styling/dashboard/dashboard.module.css';
import Card from '@/ui/components/dashboard/card';
import Chart from '@/ui/components/dashboard/chart';
import Rightbar from '@/ui/components/dashboard/rightbar';
import Transactions from '@/ui/components/dashboard/transactions';

function Dashboard() {
  return (
    <div className={styles.wrapper}>
      <div className={styles.main}>
        <div className={styles.cards}>
          <Card />
          <Card />
          <Card />
        </div>
        <Transactions />
        <Chart />
      </div>
      <div className={styles.side}>
        <Rightbar />
      </div>
    </div>
  );
}

export default Dashboard;
