import { cookies } from "next/headers";

import { APP_LOCALE_COOKIE, normalizeAppLocale } from "@/modules/i18n/config";

export async function getAppLocale() {
  const cookieStore = await cookies();

  return normalizeAppLocale(cookieStore.get(APP_LOCALE_COOKIE)?.value);
}
