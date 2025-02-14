'use client';

import React, { useCallback, memo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import styles from './editor.module.css';

const MenuBar = memo(({ editor, addImage }) => {
  if (!editor) {
    return null;
  }

  return (
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
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        className={
          editor.isActive('heading', { level: 1 }) ? styles['is-active'] : ''
        }
        aria-label="Heading 1"
      >
        H1
      </button>
      <button
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        className={
          editor.isActive('heading', { level: 2 }) ? styles['is-active'] : ''
        }
        aria-label="Heading 2"
      >
        H2
      </button>
      <button onClick={addImage} aria-label="Add Image">
        Add Image
      </button>
    </div>
  );
});

MenuBar.displayName = 'MenuBar';

const TiptapEditor = () => {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({
        inline: true,
        allowBase64: true,
      }),
    ],
    content: '<p>Start writing your blog post here...</p>',
  });

  const addImage = useCallback(() => {
    const url = window.prompt('Enter the URL of the image:');

    if (url) {
      try {
        editor.chain().focus().setImage({ src: url }).run();
      } catch (error) {
        console.error('Failed to add image:', error);
        alert('Failed to add image. Please check the URL and try again.');
      }
    }
  }, [editor]);

  if (!editor) {
    return <div>Loading editor...</div>;
  }

  return (
    <div className={styles.editor}>
      <MenuBar editor={editor} addImage={addImage} />
      <EditorContent editor={editor} />
    </div>
  );
};

export default TiptapEditor;
