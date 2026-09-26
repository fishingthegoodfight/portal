"use client";

import Link from "next/link";
import { useState } from "react";

import {
  finishVolunteerImportAction,
  importVolunteerChunkAction,
  previewVolunteerImportAction,
  type ImportPlanRow,
  type ImportRowOutcome,
} from "@/lib/actions/volunteer-import";
import {
  guessMapping,
  IMPORT_CHUNK_SIZE,
  IMPORT_FIELDS,
  parseCsv,
  templateCsv,
  toCsv,
  validValuesCsv,
  type ImportFieldKey,
  type ImportRowInput,
} from "@/lib/volunteer-import";
import { VOLUNTEER_NOTES_HELP } from "@/lib/volunteers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

type Parsed = { fileName: string; headers: string[]; rows: string[][] };
type Step = "upload" | "map" | "preview" | "importing" | "done";

function download(fileName: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/** Upload → map columns → preview → import → summary. See
 * lib/actions/volunteer-import.ts for what a row writes. */
export function VolunteerImport({ activeRoleNames }: { activeRoleNames: string[] }) {
  const [step, setStep] = useState<Step>("upload");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<(ImportFieldKey | "")[]>([]);
  const [plan, setPlan] = useState<ImportPlanRow[]>([]);
  const [outcomes, setOutcomes] = useState<ImportRowOutcome[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [ref1Changed, setRef1Changed] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setStep("upload");
    setParsed(null);
    setMapping([]);
    setPlan([]);
    setOutcomes([]);
    setRef1Changed(null);
    setError(null);
  };

  const handleFile = async (file: File) => {
    setError(null);
    const rows = parseCsv(await file.text());
    if (rows.length < 2) {
      setError("That file has no data rows under the header row.");
      return;
    }
    const headers = rows[0].map((h) => h.trim());
    setParsed({ fileName: file.name, headers, rows: rows.slice(1) });
    setMapping(guessMapping(headers));
    setStep("map");
  };

  const mappedFields = mapping.filter(Boolean) as ImportFieldKey[];
  const duplicateField = IMPORT_FIELDS.find((f) => mappedFields.filter((m) => m === f.key).length > 1);
  const emailMapped = mappedFields.includes("email");

  /** Spreadsheet row numbers: the header is row 1. */
  const buildInputs = (): ImportRowInput[] =>
    (parsed?.rows ?? []).map((cells, i) => {
      const input = { rowNumber: i + 2 } as ImportRowInput;
      for (const f of IMPORT_FIELDS) {
        const col = mapping.indexOf(f.key);
        input[f.key] = col >= 0 ? (cells[col] ?? "") : "";
      }
      return input;
    });

  const handlePreview = async () => {
    setBusy(true);
    setError(null);
    const result = await previewVolunteerImportAction(buildInputs());
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPlan(result.plan);
    setStep("preview");
  };

  const handleImport = async () => {
    const inputs = buildInputs();
    const toWrite = new Set(plan.filter((r) => r.action === "create" || r.action === "attach").map((r) => r.rowNumber));
    const rows = inputs.filter((r) => toWrite.has(r.rowNumber));
    // Rows with problems or skips are never sent — their outcome is the preview's.
    const collected: ImportRowOutcome[] = plan
      .filter((r) => r.action === "problem" || r.action === "skip")
      .map((r) => ({
        rowNumber: r.rowNumber,
        email: r.email,
        name: [r.firstName, r.lastName].filter(Boolean).join(" ") || r.existingName,
        outcome: r.action === "problem" ? "failed" : "skipped",
        message: r.action === "problem" ? r.problems.join("; ") : "Already has a volunteer record — left as is",
      }));

    setStep("importing");
    setError(null);
    setProgress({ done: 0, total: rows.length });
    for (let i = 0; i < rows.length; i += IMPORT_CHUNK_SIZE) {
      const chunk = rows.slice(i, i + IMPORT_CHUNK_SIZE);
      const result = await importVolunteerChunkAction(chunk);
      if (!result.ok) {
        // Stop here: the rest are reported as not imported, and are in the
        // failed-rows file to re-run.
        setError(`Import stopped: ${result.error}`);
        for (const r of rows.slice(i)) {
          collected.push({
            rowNumber: r.rowNumber,
            email: r.email.trim().toLowerCase(),
            name: [r.firstName, r.lastName].filter(Boolean).join(" "),
            outcome: "failed",
            message: "Not imported — the import stopped before this row",
          });
        }
        break;
      }
      collected.push(...result.outcomes);
      setProgress({ done: Math.min(i + chunk.length, rows.length), total: rows.length });
    }

    const finish = await finishVolunteerImportAction();
    setRef1Changed(finish.ok ? finish.ref1Changed : null);
    if (!finish.ok) setError((e) => e ?? `Imported, but reference checks weren't refreshed: ${finish.error}`);

    collected.sort((a, b) => a.rowNumber - b.rowNumber);
    setOutcomes(collected);
    setStep("done");
  };

  const downloadFailed = () => {
    if (!parsed) return;
    const failed = outcomes.filter((o) => o.outcome === "failed");
    const rows = failed.map((o) => [...(parsed.rows[o.rowNumber - 2] ?? []), o.message]);
    const base = parsed.fileName.replace(/\.csv$/i, "");
    download(`${base}-failed-rows.csv`, toCsv([[...parsed.headers, "Import problem"], ...rows]));
  };

  return (
    <div className="flex flex-col gap-6">
      <NoAccountsNotice />

      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}

      {step === "upload" && (
        <Card>
          <CardHeader>
            <CardTitle>1. Choose a CSV file</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <p className="text-muted-foreground">
              Any column names work — you&apos;ll match each one to a field next. Only email is required.
              Save from Excel as &quot;CSV UTF-8&quot;, or from Google Sheets with File → Download →
              Comma-separated values.
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <button
                type="button"
                className="underline underline-offset-4"
                onClick={() => download("volunteer-import-template.csv", templateCsv())}
              >
                Download template
              </button>
              <button
                type="button"
                className="underline underline-offset-4"
                onClick={() => download("volunteer-import-valid-values.csv", validValuesCsv(activeRoleNames))}
              >
                Download valid role and chapter names
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Approved roles go in one column, separated by semicolons, e.g. &quot;Men&apos;s Night
              Lead;Fly Tying Lead&quot;. They have to match an active role type&apos;s name; case
              doesn&apos;t matter. Dates as YYYY-MM-DD or M/D/YYYY.
            </p>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
          </CardContent>
        </Card>
      )}

      {step === "map" && parsed && (
        <Card>
          <CardHeader>
            <CardTitle>2. Match columns to fields</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <p className="text-muted-foreground">
              {parsed.fileName}: {parsed.rows.length} data {parsed.rows.length === 1 ? "row" : "rows"}. Columns
              set to &quot;Don&apos;t import&quot; are ignored.
            </p>
            <div className="flex flex-col divide-y rounded-md border">
              {parsed.headers.map((header, col) => (
                <div key={col} className="grid gap-2 p-3 sm:grid-cols-[1fr_14rem] sm:items-center">
                  <div className="flex min-w-0 flex-col">
                    <Label htmlFor={`map_${col}`} className="truncate">
                      {header || `Column ${col + 1} (no header)`}
                    </Label>
                    <span className="truncate text-xs text-muted-foreground">
                      e.g. {parsed.rows.slice(0, 3).map((r) => r[col]?.trim()).filter(Boolean).join(" · ") || "—"}
                    </span>
                  </div>
                  <Select
                    id={`map_${col}`}
                    value={mapping[col] ?? ""}
                    onChange={(e) => {
                      const next = [...mapping];
                      next[col] = e.target.value as ImportFieldKey | "";
                      setMapping(next);
                    }}
                  >
                    <option value="">Don&apos;t import</option>
                    {IMPORT_FIELDS.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
            {mappedFields.includes("notes") && <p className="text-xs text-muted-foreground">Notes: {VOLUNTEER_NOTES_HELP}</p>}
            {!emailMapped && <p className="text-amber-700 dark:text-amber-400">Match one column to Email.</p>}
            {duplicateField && (
              <p className="text-amber-700 dark:text-amber-400">
                {duplicateField.label} is matched to more than one column.
              </p>
            )}
            <div className="flex gap-2">
              <Button type="button" disabled={!emailMapped || Boolean(duplicateField) || busy} onClick={handlePreview}>
                {busy ? "Checking..." : "Preview import"}
              </Button>
              <Button type="button" variant="ghost" onClick={reset}>
                Choose a different file
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "preview" && (
        <ImportPreview
          plan={plan}
          onBack={() => setStep("map")}
          onConfirm={handleImport}
        />
      )}

      {step === "importing" && (
        <Card>
          <CardContent className="pt-6 text-sm">
            Importing… {progress.done} of {progress.total} rows written. Keep this page open until it finishes.
          </CardContent>
        </Card>
      )}

      {step === "done" && (
        <ImportSummary
          outcomes={outcomes}
          ref1Changed={ref1Changed}
          onDownloadFailed={downloadFailed}
          onStartOver={reset}
        />
      )}
    </div>
  );
}

function NoAccountsNotice() {
  return (
    <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
      <p className="font-semibold">This creates volunteer records, not working portal accounts. No email is sent.</p>
      <ul className="mt-1 list-disc pl-5 text-muted-foreground">
        <li>
          Each new person gets a record at &quot;Approved&quot; with their roles, and counts for reference
          checks on applications right away. Admins can add them to event rosters.
        </li>
        <li>
          They can&apos;t sign in until you send them a portal invite from the Volunteers list. Until
          then they can&apos;t sign up for events themselves, sign the volunteer waiver, fill in the
          health form or complete registration, so rosters will show those as missing.
        </li>
        <li>
          Someone whose email already has a profile gets the volunteer record added to it. Only blank
          name, phone and chapter fields are filled in. An email that&apos;s already a volunteer is
          skipped and left as is.
        </li>
      </ul>
    </div>
  );
}

const ACTION_LABELS = {
  create: "New person",
  attach: "Existing profile",
  skip: "Skip",
  problem: "Problem",
} as const;

function ImportPreview({
  plan,
  onBack,
  onConfirm,
}: {
  plan: ImportPlanRow[];
  onBack: () => void;
  onConfirm: () => void;
}) {
  const count = (action: ImportPlanRow["action"]) => plan.filter((r) => r.action === action).length;
  const writes = count("create") + count("attach");
  const problems = plan.filter((r) => r.action === "problem");
  const others = plan.filter((r) => r.action !== "problem");

  return (
    <Card>
      <CardHeader>
        <CardTitle>3. Preview — nothing written yet</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="New people" value={count("create")} />
          <Stat label="Existing profiles to update" value={count("attach")} />
          <Stat label="Skipped (already volunteers)" value={count("skip")} />
          <Stat label="Problems (not imported)" value={count("problem")} />
        </div>

        {problems.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="font-semibold">Problems</p>
            <p className="text-xs text-muted-foreground">
              These rows won&apos;t be imported. You&apos;ll be able to download them afterwards, fix
              them and import that file.
            </p>
            <ul className="flex flex-col divide-y rounded-md border">
              {problems.map((r) => (
                <li key={r.rowNumber} className="p-2">
                  <span className="font-medium">Row {r.rowNumber}</span>
                  {r.email && <span className="text-muted-foreground"> · {r.email}</span>}
                  <ul className="list-disc pl-5 text-red-600 dark:text-red-400">
                    {r.problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        )}

        {others.length > 0 && (
          <details>
            <summary className="cursor-pointer font-semibold">Every other row ({others.length})</summary>
            <ul className="mt-2 flex flex-col divide-y rounded-md border">
              {others.map((r) => (
                <li key={r.rowNumber} className="flex flex-col gap-0.5 p-2">
                  <span>
                    <span className="font-medium">Row {r.rowNumber}</span> ·{" "}
                    {[r.firstName, r.lastName].filter(Boolean).join(" ") || r.existingName || "—"} · {r.email}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {ACTION_LABELS[r.action]}
                    {r.action === "attach" && r.existingName && ` (${r.existingName})`}
                    {r.action === "attach" &&
                      (r.fills.length > 0 ? ` · fills blank ${r.fills.join(", ")}` : " · profile unchanged")}
                    {r.action !== "skip" && r.roleNames.length > 0 && ` · roles: ${r.roleNames.join(", ")}`}
                    {r.action !== "skip" && r.joinedOn && ` · joined ${r.joinedOn}`}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}

        <div className="flex gap-2">
          <Button type="button" disabled={writes === 0} onClick={onConfirm}>
            {writes === 0 ? "Nothing to import" : `Import ${writes} ${writes === 1 ? "row" : "rows"}`}
          </Button>
          <Button type="button" variant="ghost" onClick={onBack}>
            Back to columns
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ImportSummary({
  outcomes,
  ref1Changed,
  onDownloadFailed,
  onStartOver,
}: {
  outcomes: ImportRowOutcome[];
  ref1Changed: number | null;
  onDownloadFailed: () => void;
  onStartOver: () => void;
}) {
  const count = (o: ImportRowOutcome["outcome"]) => outcomes.filter((r) => r.outcome === o).length;
  const failed = count("failed");
  const withWarnings = outcomes.filter((o) => (o.outcome === "created" || o.outcome === "updated") && o.message);
  const listed = outcomes.filter((o) => o.outcome === "failed" || o.outcome === "skipped" || o.message);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import finished</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Created" value={count("created")} />
          <Stat label="Updated (existing profiles)" value={count("updated")} />
          <Stat label="Skipped" value={count("skipped")} />
          <Stat label="Failed" value={failed} />
        </div>
        {ref1Changed != null && ref1Changed > 0 && (
          <p className="text-muted-foreground">
            Reference checks re-run: {ref1Changed} open {ref1Changed === 1 ? "application's" : "applications'"} reference 1
            match changed.
          </p>
        )}
        {withWarnings.length > 0 && (
          <p className="text-amber-700 dark:text-amber-400">
            {withWarnings.length} imported {withWarnings.length === 1 ? "row" : "rows"} had a part that
            didn&apos;t save — see below and fix on their volunteer page.
          </p>
        )}
        {listed.length > 0 && (
          <ul className="flex flex-col divide-y rounded-md border">
            {listed.map((o) => (
              <li key={o.rowNumber} className="flex flex-col p-2">
                <span>
                  <span className="font-medium">Row {o.rowNumber}</span> · {o.name || "—"} · {o.email || "no email"} ·{" "}
                  {o.outcome}
                </span>
                {o.message && <span className="text-xs text-muted-foreground">{o.message}</span>}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          {failed > 0 && (
            <Button type="button" onClick={onDownloadFailed}>
              Download {failed} failed {failed === 1 ? "row" : "rows"}
            </Button>
          )}
          <Button type="button" variant="outline" asChild>
            <Link href="/protected/admin/volunteers">Back to Volunteers</Link>
          </Button>
          <Button type="button" variant="ghost" onClick={onStartOver}>
            Import another file
          </Button>
        </div>
        {failed > 0 && (
          <p className="text-xs text-muted-foreground">
            The download has your original columns plus an &quot;Import problem&quot; column. Fix the rows,
            then import that file. The extra column can stay; set it to &quot;Don&apos;t import&quot;.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
