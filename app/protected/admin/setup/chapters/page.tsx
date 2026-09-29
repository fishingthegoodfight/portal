import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { ChaptersManager } from "@/components/admin/chapters-manager";
import { loadRegionsAndChapters } from "@/lib/chapters";

async function ChaptersLoader() {
  const supabase = await createClient();
  const loaded = await loadRegionsAndChapters(supabase).catch((err: unknown) => ({
    error: err instanceof Error ? err.message : String(err),
  }));
  if ("error" in loaded) {
    return <p className="text-sm text-red-500">Couldn&apos;t load regions and chapters: {loaded.error}</p>;
  }
  return <ChaptersManager regions={loaded.regions} chapters={loaded.chapters} />;
}

export default function AdminChaptersPage() {
  return (
    <div className="flex-1 w-full flex flex-col gap-8 max-w-2xl">
      <div>
        <h1 className="font-bold text-2xl mb-1">Regions &amp; chapters</h1>
        <p className="text-sm text-muted-foreground">
          Chapters are grouped into regions. Adding, renaming, reordering or deactivating one here
          takes effect straight away, with no deploy.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
        <ChaptersLoader />
      </Suspense>
    </div>
  );
}
