'use client';

import { MdSearch } from 'react-icons/md';
import styles from './search.module.css';

function Search({ placeholder }) {
  return (
    <div className={styles.container}>
      <MdSearch alt="search icon" />
      <input
        id="searchArticle"
        type="text"
        placeholder={placeholder}
        className={styles.input}
      />
    </div>
  );
}

export default Search;
