/**
 * Extracts the first value from a query parameter that may be a string or string[].
 */
export function firstQueryValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}
