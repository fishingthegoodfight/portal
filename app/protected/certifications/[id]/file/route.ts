import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Opens a certification's file: a 5-minute signed link, made as the
 * signed-in user, so the database decides who may (the volunteer
 * themselves, or an admin — RLS on volunteer_certifications and the
 * bucket's storage policies). Anyone else gets "not found". A link rather
 * than an action so it opens in a new tab without a popup blocker.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const certId = Number(id);
  if (!Number.isInteger(certId)) return new NextResponse("Not found", { status: 404 });

  const supabase = await createClient();
  const { data: cert } = await supabase
    .from("volunteer_certifications")
    .select("file_path")
    .eq("id", certId)
    .maybeSingle();
  if (!cert?.file_path) return new NextResponse("Not found", { status: 404 });

  const { data: signed, error } = await supabase.storage
    .from("volunteer-certifications")
    .createSignedUrl(cert.file_path as string, 300);
  if (error || !signed?.signedUrl) {
    console.error(`[certifications] signed link for ${certId} failed:`, error);
    return new NextResponse("Couldn't open the file", { status: 404 });
  }
  return NextResponse.redirect(signed.signedUrl);
}
