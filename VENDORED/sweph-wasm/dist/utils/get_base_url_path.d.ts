/**
 * Normalizes a base URL by:
 *
 * - Removing trailing slashes
 * - Stripping any filename at the end (e.g., index.html, file.js)
 * - Ensuring the result ends with a single `/`
 *
 * @param url - The input URL or path to normalize
 * @returns A normalized URL ending with a single slash
 */
export declare function getBaseURLPath(url: string): string;
