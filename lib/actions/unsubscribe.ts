"use server";

import { parseEmailList, setEmailListByToken } from "@/lib/email-preferences";

/** The unsubscribe page's buttons — no sign-in; the token is the key. */
export async function setEmailListByTokenAction(
  token: string,
  list: string,
  subscribed: boolean,
): Promise<{ ok: boolean }> {
  return { ok: await setEmailListByToken(token, parseEmailList(list), subscribed) };
}
