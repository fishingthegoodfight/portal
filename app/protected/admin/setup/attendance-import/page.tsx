import Link from "next/link";

import { AttendanceImport } from "@/components/admin/attendance-import";

// Server Actions on this page take the page's limit — a chunk of new
// accounts and events can take a while.
export const maxDuration = 120;

export default function AttendanceImportPage() {
  return (
    <div className="flex-1 w-full flex flex-col gap-8 max-w-3xl">
      <div>
        <Link href="/protected/admin/setup" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Setup
        </Link>
        <h1 className="mt-2 mb-1 text-2xl font-bold">Import attendance</h1>
        <p className="text-sm text-muted-foreground">
          Bring past attendance in from a CSV file, so it counts toward engagement and the volunteer application
          threshold like a live check-in. Nothing is written until you confirm the preview, and importing the same
          file again changes nothing. No emails are sent and no waivers are recorded.
        </p>
      </div>
      <AttendanceImport />
    </div>
  );
}
