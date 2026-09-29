import { NextResponse, type NextRequest } from "next/server";

import { setOpportunitiesEmailByToken } from "@/lib/email-preferences";

/**
 * One-click unsubscribe (RFC 8058): the List-Unsubscribe-Post header on the
 * volunteer opportunities email makes Gmail, Yahoo and others show an
 * "Unsubscribe" button that POSTs here. POST only — a GET (a link checker
 * following the URL) changes nothing.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ok = await setOpportunitiesEmailByToken(token, false);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
