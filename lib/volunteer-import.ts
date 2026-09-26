import { CHAPTERS, NOT_LOCAL_CHAPTER } from "@/lib/chapters";

/**
 * Volunteer roster import (the "Import volunteers" screen): CSV parsing and
 * writing, the fields a column can map to, and the per-row checks that need
 * nothing from the database. Plain data, safe to import from client
 * components. The database side (matching emails, writing) is
 * lib/actions/volunteer-import.ts, which re-runs checkImportRow itself
 * rather than trusting the browser's result.
 */

export const IMPORT_FIELDS = [
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "chapter", label: "Home chapter" },
  { key: "roles", label: "Approved roles" },
  { key: "dateJoined", label: "Date joined" },
  { key: "notes", label: "Notes" },
] as const;
export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]["key"];

/** Rows per import request — the client sends the confirmed rows in chunks
 * this size, so a long roster never hits a request time limit. */
export const IMPORT_CHUNK_SIZE = 25;
/** More rows than this in one file is refused — split the file. */
export const IMPORT_MAX_ROWS = 2000;

/** One row as mapped: each field's raw text ("" when unmapped or blank). */
export type ImportRowInput = { rowNumber: number } & Record<ImportFieldKey, string>;

/** A row after checkImportRow — normalized values, or its problems. */
export type CheckedImportRow = {
  rowNumber: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  chapter: string;
  roleNames: string[];
  roleTypeIds: number[];
  /** YYYY-MM-DD, or "" */
  joinedOn: string;
  notes: string;
  problems: string[];
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CHAPTER_NAMES = [...CHAPTERS.map((c) => c.name), NOT_LOCAL_CHAPTER];

/** Case, spacing and curly apostrophes (Word/Excel autocorrect) don't count
 * as a difference — anything else does. */
export function normalizeName(value: string): string {
  return value.replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Validates and normalizes one row against the active role types. Never
 * guesses: an unknown role or chapter, an unreadable date or phone is a
 * problem, and a row with any problem is not imported at all.
 */
export function checkImportRow(
  row: ImportRowInput,
  activeRoleTypes: { id: number; name: string }[],
): CheckedImportRow {
  const problems: string[] = [];

  const email = row.email.trim().toLowerCase();
  if (!email) problems.push("Email is missing");
  else if (!EMAIL_PATTERN.test(email)) problems.push(`"${row.email.trim()}" isn't a valid email`);

  let phone = "";
  const phoneRaw = row.phone.trim();
  if (phoneRaw) {
    let digits = phoneRaw.replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
    if (digits.length !== 10) problems.push(`Phone "${phoneRaw}" isn't a 10-digit US number`);
    else phone = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  let chapter = "";
  const chapterRaw = row.chapter.trim();
  if (chapterRaw) {
    const match = CHAPTER_NAMES.find((c) => normalizeName(c) === normalizeName(chapterRaw));
    if (match) chapter = match;
    else problems.push(`Home chapter "${chapterRaw}" doesn't match a chapter`);
  }

  const roleByName = new Map(activeRoleTypes.map((r) => [normalizeName(r.name), r]));
  const roleNames: string[] = [];
  const roleTypeIds: number[] = [];
  const unknownRoles: string[] = [];
  for (const part of row.roles.split(";")) {
    const name = part.trim();
    if (!name) continue;
    const match = roleByName.get(normalizeName(name));
    if (!match) unknownRoles.push(name);
    else if (!roleTypeIds.includes(match.id)) {
      roleTypeIds.push(match.id);
      roleNames.push(match.name);
    }
  }
  if (unknownRoles.length > 0) {
    problems.push(
      `${unknownRoles.length === 1 ? "Role" : "Roles"} not found among active role types: ${unknownRoles
        .map((r) => `"${r}"`)
        .join(", ")}`,
    );
  }

  let joinedOn = "";
  const dateRaw = row.dateJoined.trim();
  if (dateRaw) {
    const parsed = parseImportDate(dateRaw);
    if (parsed) joinedOn = parsed;
    else problems.push(`Date joined "${dateRaw}" isn't a date (use YYYY-MM-DD or M/D/YYYY)`);
  }

  return {
    rowNumber: row.rowNumber,
    firstName: row.firstName.trim(),
    lastName: row.lastName.trim(),
    email,
    phone,
    chapter,
    roleNames,
    roleTypeIds,
    joinedOn,
    notes: row.notes.trim(),
    problems,
  };
}

/** YYYY-MM-DD or M/D/YYYY (M/D/YY read as 20YY) — the two shapes Excel and
 * Google Sheets write — to YYYY-MM-DD; null for anything else or an
 * impossible date. Never a date in the future. */
export function parseImportDate(value: string): string | null {
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(value);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (us) [m, d, y] = [Number(us[1]), Number(us[2]), Number(us[3].length === 2 ? `20${us[3]}` : us[3])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  if (y < 1990 || date.getTime() > Date.now()) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// ---- Column mapping ------------------------------------------------------------

const HEADER_GUESSES: Record<ImportFieldKey, string[]> = {
  firstName: ["firstname", "first", "givenname", "fname"],
  lastName: ["lastname", "last", "surname", "familyname", "lname"],
  email: ["email", "emailaddress", "e-mail", "mail"],
  phone: ["phone", "phonenumber", "cell", "cellphone", "mobile", "mobilephone"],
  chapter: ["homechapter", "chapter"],
  roles: ["approvedroles", "roles", "role", "volunteerroles"],
  dateJoined: ["datejoined", "joined", "joindate", "startdate", "volunteersince"],
  notes: ["notes", "note", "comments"],
};

/** A starting guess for each header's field — the admin confirms or changes
 * every one on screen. Each field goes to at most one column. */
export function guessMapping(headers: string[]): (ImportFieldKey | "")[] {
  const used = new Set<ImportFieldKey>();
  return headers.map((header) => {
    const key = header.toLowerCase().replace(/[^a-z-]/g, "");
    const field = (Object.keys(HEADER_GUESSES) as ImportFieldKey[]).find(
      (f) => !used.has(f) && HEADER_GUESSES[f].includes(key),
    );
    if (!field) return "";
    used.add(field);
    return field;
  });
}

// ---- CSV ------------------------------------------------------------------------

/**
 * RFC 4180 CSV: quoted fields (with "" escapes and line breaks inside),
 * CRLF or LF, a leading UTF-8 byte-order mark (Excel's "CSV UTF-8") ignored.
 * Fully blank lines are dropped.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

export function toCsv(rows: string[][]): string {
  const cell = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  // The BOM makes Excel read the file as UTF-8 (apostrophes, accents);
  // Google Sheets ignores it.
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** The template's header row — exactly the field labels, which
 * guessMapping maps back to their fields. */
export function templateCsv(): string {
  return toCsv([IMPORT_FIELDS.map((f) => f.label)]);
}

/**
 * The companion file of accepted values. A separate file rather than a
 * comment row: a comment row inside the template would be read as a
 * volunteer on import, and neither Excel nor Google Sheets has a CSV comment
 * syntax. Two columns, side by side.
 */
export function validValuesCsv(roleNames: string[]): string {
  const rows: string[][] = [["Approved roles (separate several with ;)", "Home chapter"]];
  for (let i = 0; i < Math.max(roleNames.length, CHAPTER_NAMES.length); i++) {
    rows.push([roleNames[i] ?? "", CHAPTER_NAMES[i] ?? ""]);
  }
  return toCsv(rows);
}
