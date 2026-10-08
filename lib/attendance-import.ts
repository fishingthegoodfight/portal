import { normalizeName, parseCsv, parseImportDate } from "@/lib/volunteer-import";
import { isEmailAddress, normalizeEmail } from "@/lib/profile-email";

/**
 * Attendance import (Setup → Import attendance): historical attendance from
 * a CSV, so engagement and the volunteer application threshold start from
 * real history. This file is the part that needs nothing from the database
 * — the fixed columns, reading the file, and per-row checks — and is safe
 * to import from client components. Matching people and events and writing
 * is lib/actions/attendance-import.ts, which re-checks every row itself.
 */

/** The file's columns, exactly (any order; extra columns are ignored). */
export const ATTENDANCE_COLUMNS = [
  "email",
  "first_name",
  "last_name",
  "phone",
  "home_chapter",
  "event_name",
  "event_date",
  "event_chapter",
  "role",
  "heard_about",
  "notes",
] as const;
export type AttendanceColumn = (typeof ATTENDANCE_COLUMNS)[number];

/** Rows per write request, so a long file never hits a request time limit. */
export const ATTENDANCE_CHUNK_SIZE = 25;
/** More rows than this in one file is refused — split the file. */
export const ATTENDANCE_MAX_ROWS = 3000;

export type AttendanceRole = "attended" | "volunteered";

/** One row as read: each column's raw text. Row numbers are the
 * spreadsheet's (the header is row 1). */
export type AttendanceRowInput = { rowNumber: number } & Record<AttendanceColumn, string>;

export type CheckedAttendanceRow = {
  rowNumber: number;
  email: string;
  firstName: string;
  lastName: string;
  /** "(303) 555-0100", or "" */
  phone: string;
  /** A chapter's name, or "" */
  homeChapter: string;
  eventName: string;
  /** YYYY-MM-DD */
  eventDate: string;
  /** A chapter's name */
  eventChapter: string;
  role: AttendanceRole | "";
  notes: string;
  /** Any of these and the row isn't imported. */
  problems: string[];
  /** Imported anyway; something was left out. */
  warnings: string[];
};

/** Reads the file: the header must have every column in ATTENDANCE_COLUMNS
 * (case and spaces aside). */
export function readAttendanceCsv(
  text: string,
): { ok: true; rows: AttendanceRowInput[]; extraColumns: string[] } | { ok: false; error: string } {
  const table = parseCsv(text).filter((cells) => cells.some((c) => c.trim()));
  if (table.length < 2) return { ok: false, error: "That file has no data rows under the header row." };
  const headers = table[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const missing = ATTENDANCE_COLUMNS.filter((c) => !headers.includes(c));
  if (missing.length > 0) {
    return { ok: false, error: `The header row is missing: ${missing.join(", ")}. It needs exactly ${ATTENDANCE_COLUMNS.join(", ")}.` };
  }
  const data = table.slice(1);
  if (data.length > ATTENDANCE_MAX_ROWS) {
    return { ok: false, error: `That's ${data.length} rows; the most one file can have is ${ATTENDANCE_MAX_ROWS}. Split it into smaller files.` };
  }
  const index = Object.fromEntries(ATTENDANCE_COLUMNS.map((c) => [c, headers.indexOf(c)])) as Record<AttendanceColumn, number>;
  const rows = data.map((cells, i) => {
    const row = { rowNumber: i + 2 } as AttendanceRowInput;
    for (const c of ATTENDANCE_COLUMNS) row[c] = (cells[index[c]] ?? "").trim();
    return row;
  });
  const extraColumns = table[0].filter((_, i) => !(ATTENDANCE_COLUMNS as readonly string[]).includes(headers[i]));
  return { ok: true, rows, extraColumns };
}

/** Validates and normalizes one row. Never guesses: an unreadable email,
 * date, event chapter or role is a problem and the row is skipped; a
 * phone or home chapter that doesn't read is left out with a warning. */
export function checkAttendanceRow(row: AttendanceRowInput, chapterNames: string[]): CheckedAttendanceRow {
  const problems: string[] = [];
  const warnings: string[] = [];
  const matchChapter = (value: string) => chapterNames.find((c) => normalizeName(c) === normalizeName(value)) ?? null;

  const email = normalizeEmail(row.email);
  if (!email) problems.push("Email is missing");
  else if (!isEmailAddress(email)) problems.push(`"${row.email}" isn't a valid email`);

  const eventDate = row.event_date ? parseImportDate(row.event_date) : null;
  if (!row.event_date) problems.push("event_date is missing");
  else if (!eventDate) problems.push(`event_date "${row.event_date}" isn't a past date (use YYYY-MM-DD or M/D/YYYY)`);

  const eventChapter = row.event_chapter ? matchChapter(row.event_chapter) : null;
  if (!row.event_chapter) problems.push("event_chapter is missing");
  else if (!eventChapter) problems.push(`event_chapter "${row.event_chapter}" isn't a chapter`);

  const roleRaw = row.role.toLowerCase();
  const role: AttendanceRole | "" = roleRaw === "attended" || roleRaw === "volunteered" ? roleRaw : "";
  if (!role) problems.push(row.role ? `role "${row.role}" must be attended or volunteered` : "role is missing");

  let phone = "";
  if (row.phone) {
    let digits = row.phone.replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
    if (digits.length === 10) phone = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    else warnings.push(`Phone "${row.phone}" isn't a 10-digit US number, so it's left out`);
  }

  let homeChapter = "";
  if (row.home_chapter) {
    const match = matchChapter(row.home_chapter);
    if (match) homeChapter = match;
    else warnings.push(`home_chapter "${row.home_chapter}" isn't a chapter, so it's left out`);
  }

  return {
    rowNumber: row.rowNumber,
    email,
    firstName: row.first_name,
    lastName: row.last_name,
    phone,
    homeChapter,
    eventName: row.event_name,
    eventDate: eventDate ?? "",
    eventChapter: eventChapter ?? "",
    role,
    notes: row.notes,
    problems,
    warnings,
  };
}

/** The key an event is matched on: the chapter that ran it and its date. */
export function eventKey(chapter: string, date: string): string {
  return `${chapter}|${date}`;
}

/** A template with just the header row. */
export function attendanceTemplateCsv(): string {
  return `${ATTENDANCE_COLUMNS.join(",")}\n`;
}
