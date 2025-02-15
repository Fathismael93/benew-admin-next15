// @/utils/sanitizers.js
export function sanitizeOutput(data) {
  if (!data) return null;

  // Create a deep copy to avoid modifying the original
  const sanitized = JSON.parse(JSON.stringify(data));

  // Basic XSS protection for text fields
  if (sanitized.article_title) {
    sanitized.article_title = sanitized.article_title
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  if (sanitized.article_text) {
    sanitized.article_text = sanitized.article_text
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  return sanitized;
}
