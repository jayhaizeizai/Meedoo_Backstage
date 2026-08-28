import { cookies } from "next/headers";
import { readSessionToken, SESSION_COOKIE } from "./auth";

export async function getCurrentUser() {
  const cookieStore = await cookies();
  return readSessionToken(cookieStore.get(SESSION_COOKIE)?.value);
}
