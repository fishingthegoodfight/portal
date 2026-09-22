"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { CHAPTERS } from "@/lib/chapters";
import { VOLUNTEER_STATUSES, VOLUNTEER_STATUS_LABELS } from "@/lib/volunteers";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

export type VolunteerRoleTypeOption = { id: number; name: string };

export function VolunteerFilters({
  status,
  chapter,
  role,
  q,
  roleTypes,
}: {
  status: string;
  chapter: string;
  role: string;
  q: string;
  roleTypes: VolunteerRoleTypeOption[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState(q);

  const navigate = (next: Partial<{ status: string; chapter: string; role: string; q: string }>) => {
    const params = new URLSearchParams({
      status: next.status ?? status,
      chapter: next.chapter ?? chapter,
      role: next.role ?? role,
      q: next.q ?? search,
    });
    for (const [key, value] of [...params.entries()]) {
      if (!value) params.delete(key);
    }
    router.push(`/protected/admin/volunteers?${params.toString()}`);
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="grid gap-1">
        <label className="text-xs text-muted-foreground" htmlFor="vf_status">
          Status
        </label>
        <Select id="vf_status" value={status} onChange={(e) => navigate({ status: e.target.value })}>
          <option value="">All statuses</option>
          {VOLUNTEER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {VOLUNTEER_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid gap-1">
        <label className="text-xs text-muted-foreground" htmlFor="vf_chapter">
          Chapter
        </label>
        <Select id="vf_chapter" value={chapter} onChange={(e) => navigate({ chapter: e.target.value })}>
          <option value="">All chapters</option>
          {CHAPTERS.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}, {c.state}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid gap-1">
        <label className="text-xs text-muted-foreground" htmlFor="vf_role">
          Role
        </label>
        <Select id="vf_role" value={role} onChange={(e) => navigate({ role: e.target.value })}>
          <option value="">All roles</option>
          {roleTypes.map((rt) => (
            <option key={rt.id} value={rt.id}>
              {rt.name}
            </option>
          ))}
        </Select>
      </div>
      <form
        className="grid gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          navigate({ q: search });
        }}
      >
        <label className="text-xs text-muted-foreground" htmlFor="vf_q">
          Search
        </label>
        <Input
          id="vf_q"
          placeholder="Name or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </form>
    </div>
  );
}
