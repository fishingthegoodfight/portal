import { Suspense } from "react";

import { UpdatePasswordForm } from "@/components/update-password-form";

// Only ever follow our own /protected/... paths — a bare prefix check keeps
// this from becoming an open redirect via a `next` like "https://evil.example"
// or "//evil.example". Same rule as app/protected/profile/page.tsx's return_to.
function safeNext(value: string | undefined): string | null {
  if (!value) return null;
  return value.startsWith("/protected/") ? value : null;
}

async function UpdatePasswordFormLoader({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <UpdatePasswordForm next={safeNext(next)} />;
}

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading...</p>}>
          <UpdatePasswordFormLoader searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
