import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { credentials } from "./config";

// For Server Actions and Route Handlers, the two places allowed to write cookies.
// Never call it from a cached response.
export async function createActionClient() {
  const { url, key } = credentials();
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

// For Server Components, which may read cookies but never write them. The
// middleware is what renews the session; writing from here would throw.
export async function createReadClient() {
  const { url, key } = credentials();
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {},
    },
  });
}
