'use client';

import React, { useState, useCallback, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextStyle from '@tiptap/extension-text-style';
import Underline from '@tiptap/extension-underline';
import Image from '@tiptap/extension-image';
import { fontSize } from '@/utils/fontSizeExtension';
import styles from './editor.module.css';

const TiptapEditor = ({ text, handleEditorChange }) => {
  const [selectedFontSize, setSelectedFontSize] = useState('16px');
  const fileInputRef = useRef(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1], // Only allow H1, remove H2
        },
      }),
      TextStyle,
      fontSize,
      Underline,
      Image.configure({
        inline: false,
        allowBase64: true,
      }),
    ],
    content: text,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      handleEditorChange(html);
    },
  });

  const handleFontSizeChange = (event) => {
    const size = event.target.value;
    setSelectedFontSize(size);
    editor?.chain().focus().setFontSize(size).run();
  };

  // Function to handle image upload from local file
  const handleImageUpload = (event) => {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target.result;
        editor?.chain().focus().setImage({ src: result }).run();
      };
      reader.readAsDataURL(file);
    }
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Function to insert image from URL
  const addImageFromUrl = useCallback(() => {
    const url = window.prompt('Enter the URL of the image:');
    if (url) {
      editor?.chain().focus().setImage({ src: url }).run();
    }
  }, [editor]);

  // Function to trigger file input click
  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  if (!editor) {
    return <div>Loading editor...</div>;
  }

  return (
    <div className={styles.editor}>
      <div className={styles.menu}>
        <button
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={editor.isActive('bold') ? styles['is-active'] : ''}
          aria-label="Bold"
        >
          Bold
        </button>
        <button
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={editor.isActive('italic') ? styles['is-active'] : ''}
          aria-label="Italic"
        >
          Italic
        </button>
        <button
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          className={editor.isActive('underline') ? styles['is-active'] : ''}
          aria-label="Underline"
        >
          Underline
        </button>
        <button
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 1 }).run()
          }
          className={
            editor.isActive('heading', { level: 1 }) ? styles['is-active'] : ''
          }
          aria-label="Heading 1"
        >
          H1
        </button>

        {/* Font Size Dropdown */}
        <select
          value={selectedFontSize}
          onChange={handleFontSizeChange}
          aria-label="Font Size"
          className={styles.fontSizeSelect}
        >
          <option value="12px">12px</option>
          <option value="14px">14px</option>
          <option value="16px">16px</option>
          <option value="18px">18px</option>
          <option value="20px">20px</option>
          <option value="24px">24px</option>
          <option value="28px">28px</option>
          <option value="32px">32px</option>
        </select>

        {/* Image Buttons */}
        <div className={styles.imageButtons}>
          <button onClick={triggerFileInput} aria-label="Upload Image">
            Upload Image
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImageUpload}
            accept="image/*"
            style={{ display: 'none' }}
          />
          <button onClick={addImageFromUrl} aria-label="Add Image URL">
            Add Image URL
          </button>
        </div>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
};

export default TiptapEditor;
