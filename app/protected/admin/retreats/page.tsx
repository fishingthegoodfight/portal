import Link from "next/link";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { AdminOnlyGate } from "@/components/admin/admin-only-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FilterPill, filterHref } from "@/components/filter-pills";
import { RegionTag } from "@/components/region-tag";
import { loadRegionsAndChapters } from "@/lib/chapters";
import { formatEventDateRange } from "@/lib/format-date";
import { regionName } from "@/lib/retreats";

const BASE_PATH = "/protected/admin/retreats";

type Row = {
  id: number;
  name: string;
  region_id: number;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
  capacity: number | null;
  spots_taken: number | null;
  status: string;
  is_published: boolean;
};

/** Every retreat, soonest first, filterable by region. Admins only: a
 * retreat's own lead reaches theirs from the Events list. */
async function RetreatsLoader({ searchParams }: { searchParams: Promise<{ region?: string }> }) {
  const { region: regionParam } = await searchParams;
  const supabase = await createClient();
  const [{ regions }, { data, error }] = await Promise.all([
    loadRegionsAndChapters(supabase),
    supabase
      .from("events")
      .select("id, name, region_id, starts_at, ends_at, timezone, capacity, spots_taken, status, is_published")
      .eq("kind", "retreat")
      .order("starts_at", { ascending: true }),
  ]);
  if (error) return <p className="text-sm text-red-500">Couldn&apos;t load retreats: {error.message}</p>;

  const rows = (data ?? []) as Row[];
  const regionId = regions.find((r) => String(r.id) === regionParam)?.id ?? null;
  const shown = regionId == null ? rows : rows.filter((r) => r.region_id === regionId);
  // eslint-disable-next-line react-hooks/purity -- Server Component: renders once per request.
  const now = Date.now();
  const upcoming = shown.filter((r) => new Date(r.ends_at ?? r.starts_at).getTime() >= now);
  const past = shown.filter((r) => new Date(r.ends_at ?? r.starts_at).getTime() < now).reverse();
  const usedRegions = regions.filter((r) => rows.some((row) => row.region_id === r.id));

  const renderRow = (r: Row) => (
    <li key={r.id} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`${BASE_PATH}/${r.id}`} className="font-medium underline-offset-4 hover:underline">
            {r.name}
          </Link>
          {r.status === "cancelled" && <Badge variant="destructive">Cancelled</Badge>}
          {!r.is_published && <Badge variant="outline">Unpublished</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <RegionTag region={regionName(r.region_id, regions)} />
          <span>{formatEventDateRange(r.starts_at, r.ends_at, r.timezone)}</span>
          <span>
            · {r.spots_taken ?? 0}
            {r.capacity != null ? ` / ${r.capacity}` : ""} registered
          </span>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={`${BASE_PATH}/${r.id}`}>Setup</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={`/protected/admin/events/${r.id}`}>Roster</Link>
        </Button>
      </div>
    </li>
  );

  return (
    <div className="flex flex-col gap-6">
      {usedRegions.length > 1 && (
        <div role="group" aria-label="Region" className="flex flex-wrap gap-2">
          <FilterPill href={BASE_PATH} active={regionId == null}>
            All
          </FilterPill>
          {usedRegions.map((r) => (
            <FilterPill key={r.id} href={filterHref(BASE_PATH, { region: String(r.id) })} active={regionId === r.id}>
              {r.name}
            </FilterPill>
          ))}
        </div>
      )}
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Upcoming ({upcoming.length})</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">No upcoming retreats.</p>
        ) : (
          <ul className="flex flex-col gap-2">{upcoming.map(renderRow)}</ul>
        )}
      </section>
      {past.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-muted-foreground">Past ({past.length})</h2>
          <ul className="flex flex-col gap-2 opacity-80">{past.map(renderRow)}</ul>
        </section>
      )}
    </div>
  );
}

export default function AdminRetreatsPage({ searchParams }: { searchParams: Promise<{ region?: string }> }) {
  return (
    <AdminOnlyGate>
      <div className="flex w-full flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Retreats</h1>
          <Button asChild>
            <Link href={`${BASE_PATH}/new`}>New retreat</Link>
          </Button>
        </div>
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
          <RetreatsLoader searchParams={searchParams} />
        </Suspense>
      </div>
    </AdminOnlyGate>
  );
}
