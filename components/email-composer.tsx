"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  checkRecipientsAction,
  deleteTemplateAction,
  listTemplatesAction,
  saveTemplateAction,
  sendBulkEmailAction,
  sendTestEmailAction,
  type ComposeTemplate,
  type RecipientCheck,
} from "@/lib/actions/bulk-email";
import { BODY_MAX, MERGE_FIELDS, signatureLines, SUBJECT_MAX, type BulkEmailSource } from "@/lib/bulk-email-text";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Write one message and send each person their own copy (Members and event
 * rosters; lib/actions/bulk-email.ts). Opens over the page. The list comes
 * back from the database with anyone who can't be emailed greyed out and
 * why; the rest can be unticked. The daily limit is checked before sending,
 * never partway through.
 */
export function EmailComposer({
  source,
  eventId = null,
  chapter,
  audience,
  userIds,
  onClose,
}: {
  source: BulkEmailSource;
  eventId?: number | null;
  /** The signature's chapter, and whose templates are offered. Null = no
   * chapter (an admin's "All chapters"). */
  chapter: string | null;
  /** Who it's for, in words, for the send history: "12 selected". */
  audience: string;
  userIds: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<RecipientCheck[]>([]);
  const [headroom, setHeadroom] = useState(0);
  const [sender, setSender] = useState<{ name: string; email: string | null }>({ name: "", email: null });
  const [isAdmin, setIsAdmin] = useState(false);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [showList, setShowList] = useState(userIds.length <= 1);

  const [templates, setTemplates] = useState<ComposeTemplate[]>([]);
  const [loaded, setLoaded] = useState<ComposeTemplate | null>(null);
  const [saving, setSaving] = useState<null | { name: string; everyChapter: boolean }>(null);

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const [busy, setBusy] = useState<null | "test" | "send" | "template">(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    Promise.all([checkRecipientsAction({ source, eventId, userIds }), listTemplatesAction(chapter)])
      .then(([check, list]) => {
        if (!current) return;
        if (!check.ok) return setLoadError(check.error);
        setRecipients(check.recipients);
        setHeadroom(check.headroom);
        setSender(check.sender);
        setIsAdmin(check.isAdmin);
        if (list.ok) setTemplates(list.templates);
      })
      .catch(() => current && setLoadError("Couldn't reach the server. Check your connection and try again."))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
    // Loaded once, when the composer opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendable = useMemo(() => recipients.filter((r) => !r.excluded), [recipients]);
  const chosen = useMemo(() => sendable.filter((r) => !unticked.has(r.userId)), [sendable, unticked]);
  const excluded = recipients.length - sendable.length;
  const overLimit = chosen.length > headroom;
  const signature = signatureLines(sender.name, chapter);
  const canSaveTemplates = chapter != null || isAdmin;

  const toggle = (userId: string) =>
    setUnticked((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });

  const insertField = (key: string) => {
    const el = bodyRef.current;
    const token = `{${key}}`;
    if (!el) return setBody((b) => b + token);
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const loadTemplate = (id: string) => {
    const t = templates.find((x) => String(x.id) === id) ?? null;
    setLoaded(t);
    setSaving(null);
    if (t) {
      setSubject(t.subject);
      setBody(t.body);
    }
  };

  const saveTemplate = async (asNew: boolean) => {
    setBusy("template");
    setError(null);
    setNotice(null);
    const target = asNew ? null : loaded;
    const result = await saveTemplateAction({
      id: target?.id ?? null,
      chapter: target ? target.chapter : saving?.everyChapter || chapter == null ? null : chapter,
      name: target ? target.name : (saving?.name ?? ""),
      subject,
      body,
    });
    setBusy(null);
    if (!result.ok) return setError(result.error);
    setTemplates((prev) =>
      [...prev.filter((t) => t.id !== result.template.id), result.template].sort((a, b) => a.name.localeCompare(b.name)),
    );
    setLoaded(result.template);
    setSaving(null);
    setNotice(asNew ? `Saved as “${result.template.name}”.` : `Updated “${result.template.name}”.`);
  };

  const removeTemplate = async () => {
    if (!loaded || !window.confirm(`Delete the template “${loaded.name}”? This can't be undone.`)) return;
    setBusy("template");
    setError(null);
    const result = await deleteTemplateAction(loaded.id);
    setBusy(null);
    if (!result.ok) return setError(result.error);
    setTemplates((prev) => prev.filter((t) => t.id !== loaded.id));
    setNotice(`Deleted “${loaded.name}”.`);
    setLoaded(null);
  };

  const sendTest = async () => {
    if (!chosen[0]) return;
    setBusy("test");
    setError(null);
    setNotice(null);
    const result = await sendTestEmailAction({ source, chapter, eventId, subject, body, sampleUserId: chosen[0].userId });
    setBusy(null);
    if (!result.ok) return setError(result.error);
    setNotice(`Test sent to ${result.to}.`);
  };

  const send = async () => {
    setBusy("send");
    setError(null);
    const result = await sendBulkEmailAction({
      source,
      chapter,
      eventId,
      audience,
      subject,
      body,
      userIds: chosen.map((r) => r.userId),
    });
    if (!result.ok) {
      setBusy(null);
      setConfirming(false);
      return setError(result.error);
    }
    router.push(`/protected/emails/${result.id}`);
  };

  const close = () => {
    if (busy === "send") return;
    if ((subject.trim() || body.trim()) && !window.confirm("Discard this message?")) return;
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center">
      <div role="dialog" aria-modal="true" aria-label="Email" className="w-full max-w-2xl">
        <Card className="max-h-[92vh] overflow-y-auto">
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle>Email</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Each person gets their own copy. Replies go to {sender.email ?? "you"}.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={close} disabled={busy === "send"}>
              Close
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {loading ? (
              <p className="text-sm text-muted-foreground">Checking the list…</p>
            ) : loadError ? (
              <p className="text-sm text-red-500">{loadError}</p>
            ) : (
              <>
                {/* Recipients */}
                <section className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm">
                      <span className="font-semibold">To: {plural(chosen.length, "person", "people")}</span>
                      {excluded > 0 && <span className="text-muted-foreground"> · {excluded} can&apos;t be emailed</span>}
                      {unticked.size > 0 && <span className="text-muted-foreground"> · {unticked.size} unticked</span>}
                    </p>
                    {recipients.length > 1 && (
                      <button
                        type="button"
                        className="text-sm underline underline-offset-4"
                        onClick={() => setShowList((v) => !v)}
                      >
                        {showList ? "Hide the list" : "Show the list"}
                      </button>
                    )}
                  </div>
                  {showList && (
                    <ul className="max-h-60 divide-y overflow-y-auto rounded-md border text-sm">
                      {recipients.map((r) => (
                        <li
                          key={r.userId}
                          className={cn("flex items-center gap-3 px-3 py-2", r.excluded && "opacity-50")}
                        >
                          <Checkbox
                            checked={!r.excluded && !unticked.has(r.userId)}
                            disabled={!!r.excluded}
                            onCheckedChange={() => toggle(r.userId)}
                            aria-label={`Send to ${r.name}`}
                          />
                          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                            {r.name}
                            {r.email && <span className="text-muted-foreground"> · {r.email}</span>}
                          </span>
                          {r.excluded && <span className="shrink-0 text-xs text-muted-foreground">{r.excluded}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {/* Templates */}
                {(templates.length > 0 || canSaveTemplates) && (
                  <section className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {templates.length > 0 && (
                        <Select
                          value={loaded ? String(loaded.id) : ""}
                          onChange={(e) => loadTemplate(e.target.value)}
                          aria-label="Load a template"
                          className="w-auto max-w-full"
                        >
                          <option value="">Load a template…</option>
                          {templates.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                              {t.chapter == null ? " (every chapter)" : ""}
                            </option>
                          ))}
                        </Select>
                      )}
                      {loaded && (loaded.chapter != null || isAdmin) && (
                        <>
                          <Button size="sm" variant="outline" disabled={busy != null} onClick={() => saveTemplate(false)}>
                            Update “{loaded.name}”
                          </Button>
                          <Button size="sm" variant="ghost" disabled={busy != null} onClick={removeTemplate}>
                            Delete
                          </Button>
                        </>
                      )}
                      {canSaveTemplates && !saving && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy != null || !subject.trim() || !body.trim()}
                          onClick={() => setSaving({ name: "", everyChapter: chapter == null })}
                        >
                          Save as template
                        </Button>
                      )}
                    </div>
                    {saving && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          autoFocus
                          placeholder="Template name"
                          value={saving.name}
                          maxLength={80}
                          onChange={(e) => setSaving({ ...saving, name: e.target.value })}
                          className="w-auto flex-1"
                          aria-label="Template name"
                        />
                        {isAdmin && chapter != null && (
                          <label className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={saving.everyChapter}
                              onCheckedChange={(c) => setSaving({ ...saving, everyChapter: c === true })}
                            />
                            Every chapter
                          </label>
                        )}
                        <Button size="sm" disabled={busy != null || !saving.name.trim()} onClick={() => saveTemplate(true)}>
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setSaving(null)}>
                          Cancel
                        </Button>
                      </div>
                    )}
                    {!isAdmin && chapter && (
                      <p className="text-xs text-muted-foreground">
                        Templates you save are shared with everyone who leads {chapter} on Members.
                      </p>
                    )}
                  </section>
                )}

                {/* Message */}
                <section className="flex flex-col gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="email_subject">Subject</Label>
                    <Input
                      id="email_subject"
                      value={subject}
                      maxLength={SUBJECT_MAX}
                      onChange={(e) => setSubject(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Label htmlFor="email_body">Message</Label>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="text-muted-foreground">Insert:</span>
                        {MERGE_FIELDS[source].map((f) => (
                          <button
                            key={f.key}
                            type="button"
                            onClick={() => insertField(f.key)}
                            className="rounded border px-1.5 py-0.5 font-mono hover:bg-accent"
                            title={f.label}
                          >
                            {`{${f.key}}`}
                          </button>
                        ))}
                      </div>
                    </div>
                    <Textarea
                      id="email_body"
                      ref={bodyRef}
                      rows={10}
                      value={body}
                      maxLength={BODY_MAX}
                      onChange={(e) => setBody(e.target.value)}
                      placeholder={"Hi {first_name},\n\n…"}
                    />
                  </div>
                  <div className="rounded-md border border-dashed px-3 py-2 text-sm">
                    <p className="text-xs text-muted-foreground">Added to the end of every copy:</p>
                    <p>{signature[0]}</p>
                    <p className="text-muted-foreground">{signature[1]}</p>
                    <p className="mt-1 text-xs text-muted-foreground">…and a link to stop chapter emails.</p>
                  </div>
                </section>

                {overLimit && (
                  <p className="rounded-md bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
                    This would send {plural(chosen.length, "email")}, but only {headroom} more can go out in the next
                    24 hours (the shared daily limit). Untick some people, or try again later.
                  </p>
                )}
                {error && <p className="text-sm text-red-500">{error}</p>}
                {notice && <p className="text-sm text-green-700 dark:text-green-400">{notice}</p>}

                <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
                  <Button
                    variant="outline"
                    disabled={busy != null || chosen.length === 0 || !subject.trim() || !body.trim()}
                    onClick={sendTest}
                  >
                    {busy === "test" ? "Sending…" : "Send me a test"}
                  </Button>
                  {confirming ? (
                    <>
                      <span className="text-sm">Send to {plural(chosen.length, "person", "people")}?</span>
                      <Button variant="ghost" disabled={busy === "send"} onClick={() => setConfirming(false)}>
                        Not yet
                      </Button>
                      <Button disabled={busy != null} onClick={send}>
                        {busy === "send" ? "Sending…" : "Yes, send"}
                      </Button>
                    </>
                  ) : (
                    <Button
                      disabled={busy != null || chosen.length === 0 || overLimit || !subject.trim() || !body.trim()}
                      onClick={() => setConfirming(true)}
                    >
                      Send to {plural(chosen.length, "person", "people")}
                    </Button>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
