import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { credentials, HOME_PATH, publicPaths, SIGN_IN_PATH } from "./config";

// Refreshing the session is the middleware's job: Server Components cannot write
// cookies, so without this a token would expire and never be renewed.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, key } = credentials();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // getUser() revalidates the token with Supabase; getSession() would trust a
  // cookie the browser could have forged. Do not replace it.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  if (!user && !publicPaths.includes(path)) return redirectTo(request, SIGN_IN_PATH);
  if (user && path === SIGN_IN_PATH) return redirectTo(request, HOME_PATH);
  return response;
}

function redirectTo(request: NextRequest, pathname: string) {
  const target = request.nextUrl.clone();
  target.pathname = pathname;
  target.search = "";
  return NextResponse.redirect(target);
}
