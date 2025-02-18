'use client';

import React, { useState, useCallback, useRef, memo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextStyle from '@tiptap/extension-text-style';
import Underline from '@tiptap/extension-underline';
import Image from '@tiptap/extension-image';
import { fontSize } from '@/utils/fontSizeExtension';
import styles from './editor.module.css';

// Memoized button component for better performance
const EditorButton = memo(({ onClick, isActive, label, children }) => (
  <button
    onClick={onClick}
    className={isActive ? styles['is-active'] : ''}
    aria-label={label}
    type="button"
  >
    {children}
  </button>
));

EditorButton.displayName = 'EditorButton';

// Font size options array
const FONT_SIZE_OPTIONS = [
  '12px',
  '14px',
  '16px',
  '18px',
  '20px',
  '24px',
  '28px',
  '32px',
];

const TiptapEditor = ({ text, handleEditorChange }) => {
  const [selectedFontSize, setSelectedFontSize] = useState('16px');
  const fileInputRef = useRef(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1],
        },
      }),
      TextStyle,
      fontSize,
      Underline,
      Image.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: {
          class: styles.editorImage,
        },
      }),
    ],
    content: text,
    onUpdate: ({ editor }) => {
      handleEditorChange(editor.getHTML());
    },
  });

  const handleFontSizeChange = useCallback(
    (event) => {
      event.preventDefault();
      const size = event.target.value;
      setSelectedFontSize(size);
      editor?.chain().focus().setFontSize(size).run();
    },
    [editor],
  );

  const handleImageUpload = useCallback(
    (event) => {
      event.preventDefault();
      const file = event.target.files?.[0];
      if (file?.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          editor?.chain().focus().setImage({ src: e.target.result }).run();
        };
        reader.readAsDataURL(file);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    },
    [editor],
  );

  const addImageFromUrl = useCallback(
    (event) => {
      event.preventDefault();
      const url = window.prompt('Enter the URL of the image:');
      if (url) {
        editor?.chain().focus().setImage({ src: url }).run();
      }
    },
    [editor],
  );

  const triggerFileInput = useCallback((event) => {
    event.preventDefault();
    fileInputRef.current?.click();
  }, []);

  if (!editor) {
    return <div>Loading editor...</div>;
  }

  return (
    <div className={styles.editor}>
      <div className={styles.menu}>
        <EditorButton
          onClick={(event) => {
            event.preventDefault();
            editor.chain().focus().toggleBold().run();
          }}
          isActive={editor.isActive('bold')}
          label="Bold"
        >
          Bold
        </EditorButton>
        <EditorButton
          onClick={(event) => {
            event.preventDefault();
            editor.chain().focus().toggleItalic().run();
          }}
          isActive={editor.isActive('italic')}
          label="Italic"
        >
          Italic
        </EditorButton>
        <EditorButton
          onClick={(event) => {
            event.preventDefault();
            editor.chain().focus().toggleUnderline().run();
          }}
          isActive={editor.isActive('underline')}
          label="Underline"
        >
          Underline
        </EditorButton>
        <EditorButton
          onClick={(event) => {
            event.preventDefault();
            editor.chain().focus().toggleHeading({ level: 1 }).run();
          }}
          isActive={editor.isActive('heading', { level: 1 })}
          label="Heading 1"
        >
          H1
        </EditorButton>

        <select
          value={selectedFontSize}
          onChange={handleFontSizeChange}
          aria-label="Font Size"
          className={styles.fontSizeSelect}
        >
          {FONT_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>

        <div className={styles.imageButtons}>
          <EditorButton onClick={triggerFileInput} label="Upload Image">
            Upload Image
          </EditorButton>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImageUpload}
            accept="image/*"
            style={{ display: 'none' }}
          />
          <EditorButton onClick={addImageFromUrl} label="Add Image URL">
            Add Image URL
          </EditorButton>
        </div>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
};

export default memo(TiptapEditor);
