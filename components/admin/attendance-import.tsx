"use client";

import { useState } from "react";

import {
  importAttendanceChunkAction,
  previewAttendanceImportAction,
  type AttendancePlan,
  type AttendancePlanRow,
  type AttendanceRowOutcome,
} from "@/lib/actions/attendance-import";
import {
  ATTENDANCE_CHUNK_SIZE,
  ATTENDANCE_COLUMNS,
  attendanceTemplateCsv,
  readAttendanceCsv,
  type AttendanceRowInput,
} from "@/lib/attendance-import";
import { toCsv } from "@/lib/volunteer-import";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Step = "upload" | "preview" | "importing" | "done";

function download(fileName: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/** Upload → preview → confirm → summary. Nothing is written until the
 * admin confirms the preview (lib/actions/attendance-import.ts). */
export function AttendanceImport() {
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [inputs, setInputs] = useState<AttendanceRowInput[]>([]);
  const [extraColumns, setExtraColumns] = useState<string[]>([]);
  const [plan, setPlan] = useState<AttendancePlan | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [outcomes, setOutcomes] = useState<AttendanceRowOutcome[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setStep("upload");
    setInputs([]);
    setPlan(null);
    setOutcomes([]);
    setConfirming(false);
    setError(null);
  };

  const handleFile = async (file: File) => {
    setError(null);
    const read = readAttendanceCsv(await file.text());
    if (!read.ok) return setError(read.error);
    setFileName(file.name);
    setInputs(read.rows);
    setExtraColumns(read.extraColumns);
    setBusy(true);
    const result = await previewAttendanceImportAction(read.rows);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setPlan(result.plan);
    setStep("preview");
  };

  const handleImport = async () => {
    if (!plan) return;
    const toWrite = new Set(plan.rows.filter((r) => r.action === "import").map((r) => r.rowNumber));
    const rows = inputs.filter((r) => toWrite.has(r.rowNumber));
    const collected: AttendanceRowOutcome[] = plan.rows
      .filter((r) => r.action !== "import")
      .map((r) => ({
        rowNumber: r.rowNumber,
        email: r.email,
        eventLabel: r.eventLabel,
        outcome: r.action === "already" ? "already" : "skipped",
        message: r.reason,
      }));
    setStep("importing");
    setConfirming(false);
    setError(null);
    setProgress({ done: 0, total: rows.length });
    for (let i = 0; i < rows.length; i += ATTENDANCE_CHUNK_SIZE) {
      const chunk = rows.slice(i, i + ATTENDANCE_CHUNK_SIZE);
      const result = await importAttendanceChunkAction(chunk);
      if (!result.ok) {
        setError(`Import stopped: ${result.error}. Re-running the same file picks up where it left off.`);
        for (const r of rows.slice(i)) {
          collected.push({
            rowNumber: r.rowNumber,
            email: r.email,
            eventLabel: [r.event_name, r.event_chapter, r.event_date].filter(Boolean).join(" · "),
            outcome: "failed",
            message: "Not imported: the import stopped before this row",
          });
        }
        break;
      }
      collected.push(...result.outcomes);
      setProgress({ done: Math.min(i + chunk.length, rows.length), total: rows.length });
    }
    collected.sort((a, b) => a.rowNumber - b.rowNumber);
    setOutcomes(collected);
    setStep("done");
  };

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}

      {step === "upload" && (
        <Card>
          <CardHeader>
            <CardTitle>Choose the CSV file</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <p className="text-muted-foreground">
              The header row needs these columns, in any order: {ATTENDANCE_COLUMNS.join(", ")}. From Google
              Sheets: File → Download → Comma-separated values.
            </p>
            <ul className="list-disc pl-5 text-muted-foreground">
              <li>role is attended or volunteered.</li>
              <li>event_chapter is the chapter that ran the event; events are matched on it and event_date.</li>
              <li>home_chapter is the person&apos;s own and may be blank.</li>
              <li>notes are shown in the preview only. heard_about isn&apos;t stored: profiles have no field for it.</li>
            </ul>
            <button
              type="button"
              className="w-fit underline underline-offset-4"
              onClick={() => download("attendance-import-template.csv", attendanceTemplateCsv())}
            >
              Download the header row
            </button>
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
            {busy && <p className="text-muted-foreground">Checking the file…</p>}
          </CardContent>
        </Card>
      )}

      {step === "preview" && plan && (
        <Preview
          fileName={fileName}
          plan={plan}
          extraColumns={extraColumns}
          confirming={confirming}
          onConfirm={() => setConfirming(true)}
          onCancelConfirm={() => setConfirming(false)}
          onImport={handleImport}
          onStartOver={reset}
        />
      )}

      {step === "importing" && (
        <Card>
          <CardContent className="pt-6 text-sm">
            Importing… {progress.done} of {progress.total} rows written. Keep this page open until it finishes.
          </CardContent>
        </Card>
      )}

      {step === "done" && <Summary fileName={fileName} outcomes={outcomes} onStartOver={reset} />}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-md border py-3">
      <span className="text-2xl font-bold">{value}</span>
      <span className="text-center text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          {title} ({count})
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm">{count === 0 ? <p className="text-muted-foreground">None.</p> : children}</CardContent>
    </Card>
  );
}

const rowWho = (r: AttendancePlanRow) => [r.firstName, r.lastName].filter(Boolean).join(" ") || r.email;

function Preview({
  fileName,
  plan,
  extraColumns,
  confirming,
  onConfirm,
  onCancelConfirm,
  onImport,
  onStartOver,
}: {
  fileName: string;
  plan: AttendancePlan;
  extraColumns: string[];
  confirming: boolean;
  onConfirm: () => void;
  onCancelConfirm: () => void;
  onImport: () => void;
  onStartOver: () => void;
}) {
  const toImport = plan.rows.filter((r) => r.action === "import");
  const already = plan.rows.filter((r) => r.action === "already");
  const skipped = plan.rows.filter((r) => r.action === "skip");
  const newPeople = plan.people.filter((p) => p.status === "new");
  const matchedPeople = plan.people.filter((p) => p.status === "matched");
  const newEvents = plan.events.filter((e) => e.status === "new");
  const matchedEvents = plan.events.filter((e) => e.status === "matched");
  const noRecord = toImport.filter((r) => r.noVolunteerRecord);
  const warned = plan.rows.filter((r) => r.warnings.length > 0 && r.action !== "skip");
  const noted = plan.rows.filter((r) => r.notes);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Preview: {fileName}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <p className="text-muted-foreground">Nothing has been written yet. Check each list below, then import.</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Rows to import" value={toImport.length} />
            <Tile label="Already recorded" value={already.length} />
            <Tile label="Skipped" value={skipped.length} />
            <Tile label="Total rows" value={plan.rows.length} />
            <Tile label="New people" value={newPeople.length} />
            <Tile label="Matched people" value={matchedPeople.length} />
            <Tile label="New events" value={newEvents.length} />
            <Tile label="Matched events" value={matchedEvents.length} />
          </div>
          {plan.heardAboutDropped && (
            <p className="text-muted-foreground">heard_about has values, but profiles have no field for it, so it won&apos;t be stored.</p>
          )}
          {extraColumns.length > 0 && (
            <p className="text-muted-foreground">Ignored columns: {extraColumns.join(", ")}.</p>
          )}
        </CardContent>
      </Card>

      <Section title="Skipped rows" count={skipped.length}>
        <ul className="flex flex-col gap-1">
          {skipped.map((r) => (
            <li key={r.rowNumber}>
              <span className="font-medium">Row {r.rowNumber}</span> · {rowWho(r)} · {r.eventLabel || "—"}:{" "}
              <span className="text-red-600 dark:text-red-400">{r.reason}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="New people (accounts will be created, no email sent)" count={newPeople.length}>
        <ul className="flex flex-col gap-1">
          {newPeople.map((p) => (
            <li key={p.email}>
              <span className="font-medium">{p.name}</span> · {p.email} · {p.rows} {p.rows === 1 ? "row" : "rows"}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Matched people (only blank fields are filled)" count={matchedPeople.length}>
        <ul className="flex flex-col gap-1">
          {matchedPeople.map((p) => (
            <li key={p.email}>
              <span className="font-medium">{p.name}</span> · {p.email} · {p.rows} {p.rows === 1 ? "row" : "rows"}
              {p.fills.length > 0 && <span className="text-muted-foreground"> · fills {p.fills.join(", ")}</span>}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="New events (created as past, unpublished, imported)" count={newEvents.length}>
        <ul className="flex flex-col gap-1">
          {newEvents.map((e) => (
            <li key={e.key}>
              <span className="font-medium">{e.name}</span> · {e.chapter} · {e.date} · {e.rows} {e.rows === 1 ? "row" : "rows"}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Matched events" count={matchedEvents.length}>
        <ul className="flex flex-col gap-1">
          {matchedEvents.map((e) => (
            <li key={e.key}>
              <span className="font-medium">{e.name}</span> · {e.chapter} · {e.date} · {e.rows} {e.rows === 1 ? "row" : "rows"}
              {e.previouslyImported && <span className="text-muted-foreground"> · made by an earlier import</span>}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Volunteered, but no volunteer record (imported anyway)" count={noRecord.length}>
        <ul className="flex flex-col gap-1">
          {noRecord.map((r) => (
            <li key={r.rowNumber}>
              <span className="font-medium">Row {r.rowNumber}</span> · {rowWho(r)} · {r.eventLabel}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Already recorded (nothing will change)" count={already.length}>
        <ul className="flex flex-col gap-1">
          {already.map((r) => (
            <li key={r.rowNumber}>
              <span className="font-medium">Row {r.rowNumber}</span> · {rowWho(r)} · {r.eventLabel}: {r.reason}
            </li>
          ))}
        </ul>
      </Section>

      {warned.length > 0 && (
        <Section title="Imported with something left out" count={warned.length}>
          <ul className="flex flex-col gap-1">
            {warned.map((r) => (
              <li key={r.rowNumber}>
                <span className="font-medium">Row {r.rowNumber}</span> · {rowWho(r)}: {r.warnings.join("; ")}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Notes (shown here only, not stored)" count={noted.length}>
        <ul className="flex flex-col gap-1">
          {noted.map((r) => (
            <li key={r.rowNumber}>
              <span className="font-medium">Row {r.rowNumber}</span> · {rowWho(r)} · {r.eventLabel || "—"}:{" "}
              <span className="italic">{r.notes}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Card>
        <CardContent className="flex flex-col gap-3 pt-6 text-sm">
          {confirming ? (
            <>
              <p className="font-medium">
                Import {toImport.length} {toImport.length === 1 ? "row" : "rows"}: create {newPeople.length} accounts
                and {newEvents.length} events, and record the attendance?
              </p>
              <div className="flex gap-2">
                <Button onClick={onImport}>Yes, import</Button>
                <Button variant="outline" onClick={onCancelConfirm}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              <Button disabled={toImport.length === 0} onClick={onConfirm}>
                Import {toImport.length} {toImport.length === 1 ? "row" : "rows"}
              </Button>
              <Button variant="ghost" onClick={onStartOver}>
                Choose a different file
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Summary({
  fileName,
  outcomes,
  onStartOver,
}: {
  fileName: string;
  outcomes: AttendanceRowOutcome[];
  onStartOver: () => void;
}) {
  const count = (o: AttendanceRowOutcome["outcome"]) => outcomes.filter((x) => x.outcome === o).length;
  const problems = outcomes.filter((o) => o.outcome === "failed" || o.outcome === "skipped");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Done: {fileName}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Imported" value={count("imported")} />
          <Tile label="Already recorded" value={count("already")} />
          <Tile label="Skipped" value={count("skipped")} />
          <Tile label="Failed" value={count("failed")} />
        </div>
        {problems.length > 0 && (
          <>
            <ul className="flex flex-col gap-1">
              {problems.map((o) => (
                <li key={o.rowNumber}>
                  <span className="font-medium">Row {o.rowNumber}</span> · {o.email} · {o.eventLabel}:{" "}
                  <span className={o.outcome === "failed" ? "text-red-600 dark:text-red-400" : ""}>{o.message}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="w-fit underline underline-offset-4"
              onClick={() =>
                download(
                  `${fileName.replace(/\.csv$/i, "")}-not-imported.csv`,
                  toCsv([["row", "email", "event", "outcome", "reason"], ...problems.map((o) => [String(o.rowNumber), o.email, o.eventLabel, o.outcome, o.message])]),
                )
              }
            >
              Download these rows
            </button>
          </>
        )}
        <Button variant="outline" className="w-fit" onClick={onStartOver}>
          Import another file
        </Button>
      </CardContent>
    </Card>
  );
}
