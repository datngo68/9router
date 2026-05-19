import { marked } from "marked";
import DOMPurify from "isomorphic-dompurify";

// Configure marked once for the module
marked.setOptions({ gfm: true, breaks: true });

// Allowed extras for anchors that we post-process to open externally
const SANITIZE_OPTS = {
  ADD_ATTR: ["target", "rel"],
  // Drop dangerous protocols by default; DOMPurify already strips javascript:, data: for SVG, etc.
  // Keep things conservative: no <iframe>, no <object>, no <embed>, no inline event handlers.
  FORBID_TAGS: ["style", "iframe", "object", "embed", "form"],
  FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur"],
};

/**
 * Render untrusted markdown to safe HTML.
 * Always parse with marked then sanitize with DOMPurify.
 * Anchors are post-processed to add target="_blank" rel="noopener noreferrer".
 *
 * @param {string} text untrusted markdown
 * @returns {string} sanitized HTML, safe for dangerouslySetInnerHTML
 */
export function renderSafeMarkdown(text) {
  if (!text) return "";
  const rawHtml = marked.parse(String(text));
  const safeHtml = DOMPurify.sanitize(rawHtml, SANITIZE_OPTS);
  // After sanitization, force external-target on remaining anchors.
  return safeHtml.replace(/<a (?![^>]*\btarget=)/g, '<a target="_blank" rel="noopener noreferrer" ');
}

/**
 * Sanitize already-parsed HTML (e.g. when caller did marked.parse manually).
 * Use renderSafeMarkdown unless you have a reason to call this directly.
 */
export function sanitizeHtml(html) {
  if (!html) return "";
  return DOMPurify.sanitize(String(html), SANITIZE_OPTS);
}
