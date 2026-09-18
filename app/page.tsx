import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ThemeSwitcher } from "@/components/theme-switcher";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center">
      <div className="flex-1 w-full flex flex-col gap-20 items-center">
        <div className="flex-1 flex flex-col items-center justify-center gap-6 max-w-xl p-5 text-center">
          <h1 className="text-3xl lg:text-4xl font-bold !leading-tight">
            Fishing the Good Fight participant portal
          </h1>
          <p className="text-lg text-muted-foreground">
            This is where you RSVP to chapter events and manage your
            information.
          </p>
          <div className="flex gap-3">
            <Button asChild size="lg" variant="outline">
              <Link href="/auth/login">Sign in</Link>
            </Button>
            <Button asChild size="lg">
              <Link href="/auth/sign-up">Sign up</Link>
            </Button>
          </div>
        </div>

        <footer className="w-full flex items-center justify-center border-t mx-auto text-center text-xs gap-8 py-16">
          <p>
            Powered by{" "}
            <a
              href="https://supabase.com/?utm_source=create-next-app&utm_medium=template&utm_term=nextjs"
              target="_blank"
              className="font-bold hover:underline"
              rel="noreferrer"
            >
              Supabase
            </a>
          </p>
          <ThemeSwitcher />
        </footer>
      </div>
    </main>
  );
}
