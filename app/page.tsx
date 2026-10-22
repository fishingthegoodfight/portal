import Image from "next/image";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ThemeSwitcher } from "@/components/theme-switcher";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center">
      <div className="flex-1 w-full flex flex-col gap-20 items-center">
        <div className="flex-1 flex flex-col items-center justify-center gap-6 max-w-xl p-5 text-center">
          <Image
            src="/brand/FTGF_Logo_2Color.png"
            alt=""
            width={1547}
            height={826}
            priority
            className="w-64 h-auto dark:hidden"
          />
          <Image
            src="/brand/FTGF_Logo_2Color_Reversed.png"
            alt=""
            width={1547}
            height={827}
            priority
            className="hidden w-64 h-auto dark:block"
          />
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

        <footer className="w-full flex items-center justify-center border-t mx-auto text-center text-xs gap-8 py-6">
          <ThemeSwitcher />
        </footer>
      </div>
    </main>
  );
}
