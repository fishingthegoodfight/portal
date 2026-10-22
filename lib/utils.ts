import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** A stable key from a display name: "Men's Nights" → "mens_nights".
 * `fallback` when nothing usable is left. */
export function keyFromLabel(label: string, fallback: string): string {
  return (
    label
      .toLowerCase()
      .replace(/'/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || fallback
  );
}
