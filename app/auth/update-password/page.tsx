import { Suspense } from "react";

import { UpdatePasswordForm } from "@/components/update-password-form";
import { safeNext } from "@/lib/safe-next";

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
