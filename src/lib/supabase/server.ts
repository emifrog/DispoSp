import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Reserved for future authenticated server actions. The demo never calls it.
// Refresh cookies in an action or route handler; never in a cached response.
export async function createActionClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Le projet Supabase n’est pas encore configuré.");
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(values) {
        values.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
      },
    },
  });
}
