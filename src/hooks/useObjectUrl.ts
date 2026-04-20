import { useCallback, useRef, useEffect } from 'react';

/**
 * Safely manage object URLs with automatic cleanup
 * Prevents memory leaks by revoking previous URLs before creating new ones
 */
export function useObjectUrl() {
  const objectUrlRef = useRef<string | null>(null);

  /**
   * Create object URL from Blob
   * Automatically revokes previous URL if exists
   */
  const createObjectUrl = useCallback((blob: Blob): string => {
    // Revoke previous URL to prevent memory leak
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }

    // Create new URL
    const url = URL.createObjectURL(blob);
    objectUrlRef.current = url;
    return url;
  }, []);

  /**
   * Manually revoke current URL
   */
  const revokeObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  /**
   * Get current object URL
   */
  const getObjectUrl = useCallback(() => {
    return objectUrlRef.current;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  return {
    createObjectUrl,
    revokeObjectUrl,
    getObjectUrl,
  };
}
