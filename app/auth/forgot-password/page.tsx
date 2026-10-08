import { redirect } from "next/navigation";

import { codePagePath } from "@/lib/code-page";

/** "Forgot password" is the code page now (app/auth/code, mode reset):
 * the code is emailed when they ask for it there. Kept as a redirect so
 * old links and bookmarks still work. */
export default async function Page({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  redirect(codePagePath({ mode: "reset", email: email ?? null }));
}
