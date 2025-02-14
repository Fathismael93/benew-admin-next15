'use client';

import React, { useCallback, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Image from '@tiptap/extension-image';
import styles from './editor.module.css';

const TiptapEditor = ({ text, handleEditorChange }) => {
  const [selectedColor, setSelectedColor] = useState('#000000'); // Default color is black

  const editor = useEditor({
    extensions: [
      StarterKit,
      TextStyle, // Enable text styling
      Color.configure({ types: ['textStyle'] }), // Enable color extension
      Image.configure({
        inline: true,
        allowBase64: true,
      }),
    ],
    content: text, // Initialize editor with the state content
    onUpdate: ({ editor }) => {
      const html = editor.getHTML(); // Get the current content as HTML
      handleEditorChange(html); // Update the state with the new content
    },
  });

  const addImage = useCallback(() => {
    const url = window.prompt('Enter the URL of the image:');

    if (url) {
      try {
        editor?.chain().focus().setImage({ src: url }).run();
      } catch (error) {
        console.error('Failed to add image:', error);
        alert('Failed to add image. Please check the URL and try again.');
      }
    }
  }, [editor]);

  const handleColorChange = (color) => {
    setSelectedColor(color); // Update the selected color state
    editor?.chain().focus().setColor(color).run(); // Apply the color to the selected text
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
        <button
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
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
        {/* Color Picker */}
        <input
          type="color"
          value={selectedColor}
          onChange={(e) => handleColorChange(e.target.value)}
          aria-label="Text Color"
        />
      </div>
      <EditorContent editor={editor} />
    </div>
  );
};

export default TiptapEditor;
