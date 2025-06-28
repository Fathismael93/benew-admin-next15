'use client';

import { MdSearch } from 'react-icons/md';
import styles from './search.module.css';

function AppSearch({ placeholder }) {
  return (
    <div className={styles.container}>
      <MdSearch alt="search icon" />
      <input
        id="searchApp"
        type="text"
        placeholder={placeholder}
        className={styles.input}
      />
    </div>
  );
}

export default AppSearch;
