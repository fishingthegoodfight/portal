"use server";

import { setOpportunitiesEmailByToken } from "@/lib/email-preferences";

/** The unsubscribe page's buttons — no sign-in; the token is the key. */
export async function setOpportunitiesEmailByTokenAction(
  token: string,
  subscribed: boolean,
): Promise<{ ok: boolean }> {
  return { ok: await setOpportunitiesEmailByToken(token, subscribed) };
}
