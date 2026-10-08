import { redirect } from "next/navigation";
import { Suspense } from "react";

import { codePagePath } from "@/lib/code-page";

async function RedirectToCodePage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  redirect(codePagePath({ mode: "reset", email: email ?? null }));
  return null;
}

/** "Forgot password" is the code page now (app/auth/code, mode reset):
 * the code is emailed when they ask for it there. Kept as a redirect so
 * old links and bookmarks still work. searchParams is read inside
 * Suspense, as Cache Components requires. */
export default function Page({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  return (
    <Suspense fallback={null}>
      <RedirectToCodePage searchParams={searchParams} />
    </Suspense>
  );
}
