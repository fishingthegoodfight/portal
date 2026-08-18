/**
 * Formats a US phone number as the user types into `(303) 555-0100`, so
 * everyone's number is stored in the same shape regardless of how they typed
 * it in (dashes, dots, spaces, or nothing at all).
 */
export function formatPhoneNumber(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 10);

  if (digits.length === 0) return "";
  if (digits.length < 4) return `(${digits}`;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * Formats a US ZIP code as `12345` or, once a 6th digit is entered,
 * `12345-6789`, so ZIP+4 always comes in dash-formatted.
 */
export function formatPostalCode(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 9);

  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}
