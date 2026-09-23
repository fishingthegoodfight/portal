import { Suspense } from "react";

import { SignUpForm } from "@/components/sign-up-form";
import { safeNext } from "@/lib/safe-next";

async function SignUpFormLoader({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <SignUpForm next={safeNext(next)} />;
}

export default function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Suspense fallback={<SignUpForm next={null} />}>
          <SignUpFormLoader searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
