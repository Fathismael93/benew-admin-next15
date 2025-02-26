'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CldImage, CldUploadWidget } from 'next-cloudinary';
import axios from 'axios';
import styles from '@/ui/styling/dashboard/applications/edit/editApplication.module.css';
import { MdArrowBack } from 'react-icons/md';
import Link from 'next/link';

function EditApplication({ application }) {
  const router = useRouter();

  const [name, setName] = useState(application.application_name);
  const [link, setLink] = useState(application.application_link);
  const [description, setDescription] = useState(
    application.application_description,
  );
  const [fee, setFee] = useState(application.application_fee);
  const [rent, setRent] = useState(application.application_rent);
  const [category, setCategory] = useState(application.application_category);
  const [type, setType] = useState(application.application_type);
  const [imageUrls, setImageUrls] = useState(application.application_images);
  const [otherVersions, setOtherVersions] = useState(
    application.application_other_versions?.join(', ') || '',
  );
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!name || name.length < 3) {
      setErrorMessage('Name is missing');
      return;
    }

    if (!link || link.length < 3) {
      setErrorMessage('Link is missing');
      return;
    }

    if (!fee || fee === 0) {
      setErrorMessage('Fee is missing');
      return;
    }

    if (!rent || rent < 0) {
      setErrorMessage('Rent is missing');
      return;
    }

    if (!category) {
      setErrorMessage('Category is missing');
      return;
    }

    if (!type) {
      setErrorMessage('Type is missing');
      return;
    }

    if (imageUrls.length === 0) {
      setErrorMessage('At least one image is required');
      return;
    }

    const response = await axios.put(
      `/api/dashboard/applications/${application.application_id}/edit`,
      JSON.stringify({
        name,
        link,
        description: description || null,
        category,
        type,
        fee,
        rent,
        imageUrls,
        otherVersions: otherVersions?.split(',')?.map((url) => url?.trim()),
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      },
    );

    if (response.data.success) {
      router.push('/dashboard/applications');
    }
  };

  return (
    <div className={styles.editApplicationContainer}>
      <Link href="/dashboard/applications" className={styles.backButton}>
        <MdArrowBack /> Back to Applications
      </Link>
      <h1>Edit Application</h1>
      <form className={styles.editApplicationForm} onSubmit={handleSubmit}>
        {errorMessage && <p className={styles.errorMessage}>{errorMessage}</p>}
        <div className={styles.inputs}>
          <input
            type="text"
            name="name"
            placeholder="Application Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            type="text"
            name="link"
            placeholder="Application Link"
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
          <input
            type="text"
            name="fee"
            placeholder="Application Fee"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
          />
          <input
            type="text"
            name="rent"
            placeholder="Application Rent"
            value={rent}
            onChange={(e) => setRent(e.target.value)}
          />
          <input
            type="text"
            name="type"
            placeholder="Application Type"
            value={type}
            onChange={(e) => setType(e.target.value)}
          />
          <input
            type="text"
            name="otherVersions"
            placeholder="Other Versions (comma-separated)"
            value={otherVersions}
            onChange={(e) => setOtherVersions(e.target.value)}
          />
        </div>
        <textarea
          name="description"
          className={styles.description}
          placeholder="Application Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows="5"
        />
        <div className={styles.radioButtons}>
          <label>
            <input
              type="radio"
              name="category"
              value="web"
              checked={category === 'web'}
              onChange={(e) => setCategory(e.target.value)}
            />
            Web
          </label>
          <label>
            <input
              type="radio"
              name="category"
              value="mobile"
              checked={category === 'mobile'}
              onChange={(e) => setCategory(e.target.value)}
            />
            Mobile
          </label>
        </div>
        <CldUploadWidget
          signatureEndpoint="/api/dashboard/applications/add/sign-image"
          onSuccess={(result) => {
            setImageUrls((prev) => [...prev, result?.info?.public_id]);
            console.log('Image saved successfully in cloudinary');
            console.log(imageUrls);
          }}
          options={{
            folder: 'applications',
            multiple: true,
          }}
        >
          {({ open }) => {
            function handleOnClick(e) {
              e.preventDefault();
              open();
            }
            return (
              <button
                className={styles.addImage}
                onClick={handleOnClick}
                type="button"
              >
                Add Image
              </button>
            );
          }}
        </CldUploadWidget>
        <div className={styles.images}>
          {imageUrls.map((url, index) => (
            <div key={index} className={styles.imageContainer}>
              <CldImage
                width="200"
                height="150"
                src={url}
                alt={`Application image ${index + 1}`}
                className={styles.image}
              />
              <button
                type="button"
                className={styles.removeImage}
                onClick={() =>
                  setImageUrls((prev) => prev.filter((_, i) => i !== index))
                }
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <button type="submit" className={styles.saveButton}>
          Save Changes
        </button>
      </form>
    </div>
  );
}

export default EditApplication;
