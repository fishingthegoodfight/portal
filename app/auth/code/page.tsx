import { Suspense } from "react";

import { AccessCodeForm } from "@/components/access-code-form";
import { isCodeMode } from "@/lib/code-page";
import { safeNext } from "@/lib/safe-next";

type Params = { mode?: string; email?: string; next?: string; sent?: string };

async function CodeFormLoader({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const mode = isCodeMode(params.mode) ? params.mode : "reset";
  return (
    <AccessCodeForm
      mode={mode}
      initialEmail={(params.email ?? "").trim()}
      next={safeNext(params.next)}
      justSent={params.sent === "1"}
    />
  );
}

/**
 * The one page for every password set-up, password reset and sign-up
 * confirmation: type the six-digit code you asked for (lib/code-page.ts).
 * Links to it carry no secret, so they never expire.
 */
export default function Page({ searchParams }: { searchParams: Promise<Params> }) {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Suspense fallback={null}>
          <CodeFormLoader searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
