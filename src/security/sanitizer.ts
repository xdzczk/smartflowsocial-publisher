/**
 * Maximum content size in bytes (1MB)
 */
const MAX_CONTENT_SIZE = 1024 * 1024;

/**
 * Maximum number of tags
 */
const MAX_TAGS = 1000;

/**
 * Maximum tag array length
 */
const MAX_TAG_LENGTH = 100;

/**
 * Maximum individual tag element length
 */
const MAX_TAG_ELEMENT_LENGTH = 1000;

/**
 * Validates UTF-8 encoding
 * @param str The string to validate
 * @returns true if valid UTF-8, false otherwise
 */
function isValidUTF8(str: string): boolean {
  try {
    // Try to encode and decode - if it matches, it's valid UTF-8
    const encoded = new TextEncoder().encode(str);
    const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(encoded);
    return decoded === str;
  } catch {
    return false;
  }
}

/**
 * Sanitizes event content to prevent XSS and other attacks
 * @param content The content to sanitize
 * @returns Sanitized content
 * @throws {Error} if content is invalid
 */
export function sanitizeContent(content: string): string {
  // Validate input type
  if (typeof content !== 'string') {
    throw new Error('Content must be a string');
  }

  // Check size (using byte length, not character length)
  const byteLength = new TextEncoder().encode(content).length;
  if (byteLength > MAX_CONTENT_SIZE) {
    throw new Error(
      `Content exceeds maximum size of ${MAX_CONTENT_SIZE} bytes (received: ${byteLength} bytes)`
    );
  }

  // Validate UTF-8 encoding
  if (!isValidUTF8(content)) {
    throw new Error('Content must be valid UTF-8 encoded');
  }

  // Note: We don't HTML-encode the content by default because:
  // 1. Nostr events are typically JSON-encoded when transmitted
  // 2. Content may contain markdown, plain text, or other formats
  // 3. The client application should handle rendering safely
  // 
  // However, if you're storing content in HTML context, you should
  // use encodeHTMLEntities() at render time, not at storage time.
  //
  // For now, we just validate encoding and size, which prevents
  // most injection attacks while preserving content integrity.

  return content;
}

/**
 * Validates and sanitizes event tags
 * @param tags The tags array to validate
 * @returns Validated tags array
 * @throws {Error} if tags are invalid
 */
export function sanitizeTags(tags: unknown[][]): unknown[][] {
  if (!Array.isArray(tags)) {
    throw new Error('Tags must be an array');
  }

  if (tags.length > MAX_TAGS) {
    throw new Error(`Tags array exceeds maximum length of ${MAX_TAGS} (received: ${tags.length})`);
  }

  return tags.map((tag, tagIndex) => {
    if (!Array.isArray(tag)) {
      throw new Error(`Tag at index ${tagIndex} must be an array`);
    }

    if (tag.length > MAX_TAG_LENGTH) {
      throw new Error(
        `Tag at index ${tagIndex} exceeds maximum length of ${MAX_TAG_LENGTH} (received: ${tag.length})`
      );
    }

    // Validate and sanitize tag elements
    return tag.map((item, itemIndex) => {
      // Tag elements must be strings or numbers
      if (typeof item !== 'string' && typeof item !== 'number') {
        throw new Error(
          `Tag element at [${tagIndex}][${itemIndex}] must be a string or number (received: ${typeof item})`
        );
      }

      // Convert to string for validation
      const strValue = String(item);

      // Validate string length (if it's a string or converted from number)
      if (strValue.length > MAX_TAG_ELEMENT_LENGTH) {
        throw new Error(
          `Tag element at [${tagIndex}][${itemIndex}] exceeds maximum length of ${MAX_TAG_ELEMENT_LENGTH} (received: ${strValue.length})`
        );
      }

      // Validate UTF-8 encoding for strings
      if (typeof item === 'string' && !isValidUTF8(item)) {
        throw new Error(
          `Tag element at [${tagIndex}][${itemIndex}] must be valid UTF-8 encoded`
        );
      }

      // Return original value (preserve type: string or number)
      return item;
    });
  });
}

/**
 * Validates event structure for security
 * @param event The event to validate
 * @returns Validated and sanitized event
 * @throws {Error} if event is invalid
 */
export function sanitizeEvent(event: {
  content: string;
  tags: unknown[][];
}): { content: string; tags: unknown[][] } {
  // Validate event structure
  // Note: typeof null === 'object' in JavaScript, so we need explicit null check
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- null check needed for runtime validation
  if (typeof event !== 'object' || event === null) {
    throw new Error('Event must be an object');
  }

  if (typeof event.content !== 'string') {
    throw new Error('Event content must be a string');
  }

  if (!Array.isArray(event.tags)) {
    throw new Error('Event tags must be an array');
  }

  return {
    content: sanitizeContent(event.content),
    tags: sanitizeTags(event.tags),
  };
}

/**
 * Exports HTML entity encoding function for use in rendering contexts
 * This should be used when rendering content in HTML, not when storing
 * @param str The string to encode
 * @returns HTML-encoded string
 */
export function encodeHTMLEntities(str: string): string {
  const entityMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;',
  };

  return str.replace(/[&<>"'/]/g, (char) => entityMap[char] ?? char);
}
