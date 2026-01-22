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
 * Sanitizes event content to prevent XSS and other attacks
 * @param content The content to sanitize
 * @returns Sanitized content
 */
export function sanitizeContent(content: string): string {
  // Check size
  if (content.length > MAX_CONTENT_SIZE) {
    throw new Error(`Content exceeds maximum size of ${MAX_CONTENT_SIZE} bytes`);
  }

  // For now, just return as-is since Nostr events are typically JSON
  // In production, you might want to add more sanitization
  // For example, if content is HTML, you could sanitize it
  return content;
}

/**
 * Validates and sanitizes event tags
 * @param tags The tags array to validate
 * @returns Validated tags array
 */
export function sanitizeTags(tags: unknown[][]): unknown[][] {
  if (!Array.isArray(tags)) {
    throw new Error('Tags must be an array');
  }

  if (tags.length > MAX_TAGS) {
    throw new Error(`Tags array exceeds maximum length of ${MAX_TAGS}`);
  }

  return tags.map((tag) => {
    if (!Array.isArray(tag)) {
      throw new Error('Each tag must be an array');
    }

    if (tag.length > MAX_TAG_LENGTH) {
      throw new Error(`Tag array exceeds maximum length of ${MAX_TAG_LENGTH}`);
    }

    // Validate tag elements are strings or numbers
    return tag.map((item) => {
      if (typeof item !== 'string' && typeof item !== 'number') {
        throw new Error('Tag elements must be strings or numbers');
      }
      return item;
    });
  });
}

/**
 * Validates event structure for security
 * @param event The event to validate
 * @returns Validated and sanitized event
 */
export function sanitizeEvent(event: {
  content: string;
  tags: unknown[][];
}): { content: string; tags: unknown[][] } {
  return {
    content: sanitizeContent(event.content),
    tags: sanitizeTags(event.tags),
  };
}
