import { NextResponse } from "next/server";
import { isConnected, SIGN_IN_PATH } from "@/lib/supabase/config";
import { createActionClient } from "@/lib/supabase/server";

// A POST route rather than a client call: signing out has to clear the cookies
// the server reads, and a Route Handler is one of the two places allowed to
// write them. It also works without JavaScript.
export async function POST(request: Request) {
  if (isConnected) {
    const supabase = await createActionClient();
    await supabase.auth.signOut();
  }
  return NextResponse.redirect(new URL(SIGN_IN_PATH, request.url), { status: 303 });
}
