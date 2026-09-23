import { Suspense } from "react";

import { LoginForm } from "@/components/login-form";
import { safeNext } from "@/lib/safe-next";

async function LoginFormLoader({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <LoginForm next={safeNext(next)} />;
}

export default function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Suspense fallback={<LoginForm next={null} />}>
          <LoginFormLoader searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
