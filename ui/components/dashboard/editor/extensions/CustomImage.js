import Image from '@tiptap/extension-image';

// Custom extension to override the default image rendering
const CustomImage = Image.extend({
  renderHTML({ HTMLAttributes }) {
    // Extract the public_id from the src attribute
    // The src will be in format: 'https://res.cloudinary.com/your-cloud-name/image/upload/v123456/blog_pictures/image-id'
    let publicId = '';
    if (HTMLAttributes.src && HTMLAttributes.src.includes('cloudinary.com')) {
      const urlParts = HTMLAttributes.src.split('/');
      // Find the index of 'upload' in the URL
      const uploadIndex = urlParts.findIndex((part) => part === 'upload');
      if (uploadIndex !== -1 && urlParts.length > uploadIndex + 2) {
        // Skip the version (v123456) and get the rest of the path
        publicId = urlParts.slice(uploadIndex + 2).join('/');
      }
    }

    if (publicId) {
      // Create a custom element that the client code will replace with CldImage
      return [
        'cloudinary-image',
        {
          'data-public-id': publicId,
          'data-width': HTMLAttributes.width || '800',
          'data-height': HTMLAttributes.height || '600',
          'data-alt': HTMLAttributes.alt || '',
          class: HTMLAttributes.class,
        },
      ];
    }

    // Fallback to regular image if not a Cloudinary URL
    return ['img', HTMLAttributes];
  },
});

export default CustomImage;
