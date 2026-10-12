import { NextResponse, type NextRequest } from "next/server";

import { parseEmailList, setEmailListByToken } from "@/lib/email-preferences";

/**
 * One-click unsubscribe (RFC 8058): the List-Unsubscribe-Post header on the
 * volunteer opportunities email, and on chapter emails (?list=chapter), makes Gmail, Yahoo and others show an
 * "Unsubscribe" button that POSTs here. POST only — a GET (a link checker
 * following the URL) changes nothing.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ok = await setEmailListByToken(token, parseEmailList(request.nextUrl.searchParams.get("list")), false);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
