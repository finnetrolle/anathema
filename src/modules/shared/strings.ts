/**
 * Removes trailing slashes from a URL or path string.
 */
export function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}
