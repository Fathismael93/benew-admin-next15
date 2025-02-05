/* eslint-disable camelcase */
import React from 'react';
import { MdClose, MdModeEdit } from 'react-icons/md';
import styles from './presCard.module.css';

function PresCard({ pres_id, title, text, deletePresentation }) {
  return (
    <div className={styles.presentation} key={pres_id}>
      <h2 className={styles.presentationTitle}>{title}</h2>
      <p>{text}</p>
      <div className={styles.icon}>
        <MdModeEdit className={styles.edit} />
        <MdClose
          className={styles.delete}
          onClick={() => deletePresentation(pres_id)}
        />
      </div>
    </div>
  );
}

export default PresCard;
