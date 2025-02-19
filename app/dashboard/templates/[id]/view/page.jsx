import SingleTemplate from '@/ui/pages/templates/SingleTemplate';
import React from 'react';

async function getSingleTemplate(id) {
  try {
    const response = await fetch(`/api/dashboard/templates/${id}/view`);

    if (response.ok) {
      // Remove the template from the UI without refreshing
      window.location.reload();
    } else {
      console.error('Failed to get template');
    }
  } catch (error) {
    console.error('Error getting template:', error);
  } finally {
  }
}

const SingleTemplatePage = async ({ params }) => {
  const { id } = await params;
  const singleTemplate = await getSingleTemplate(id);

  return <SingleTemplate singleTemplate={singleTemplate} />;
};

export default SingleTemplatePage;
