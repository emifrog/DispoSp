import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError } from "@supabase/supabase-js";

// La lecture de session des écrans et des actions : une panne d'Auth doit
// lever, pas se faire passer pour « personne n'est connecté ».
const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("../src/lib/supabase/server", () => ({
  createReadClient: async () => ({
    auth: { getUser },
    from: () => ({
      select: () => {
        const chain = { eq: () => chain, maybeSingle: async () => ({ data: null, error: null }) };
        return chain;
      },
    }),
  }),
}));
import { readSession, SESSION_UNVERIFIED } from "../src/lib/session.server";

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Lecture de la session", () => {
  it("rend null sans session, ou avec un jeton refusé", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new AuthSessionMissingError() });
    await expect(readSession()).resolves.toBeNull();
    getUser.mockResolvedValue({ data: { user: null }, error: new AuthApiError("invalid JWT", 401, "bad_jwt") });
    await expect(readSession()).resolves.toBeNull();
  });

  it("lève, plutôt que de rendre null, quand Auth ne répond pas", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new AuthRetryableFetchError("fetch failed", 0) });
    await expect(readSession()).rejects.toThrow(SESSION_UNVERIFIED);
    getUser.mockResolvedValue({ data: { user: null }, error: new AuthApiError("boom", 500, "unexpected_failure") });
    await expect(readSession()).rejects.toThrow(SESSION_UNVERIFIED);
    // La cause part au journal, pas à l'écran.
    expect(console.error).toHaveBeenCalledWith("Supabase Auth injoignable :", "fetch failed");
  });

  it("lit un agent connecté", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "agent", email: "agent@example.org" } }, error: null });
    await expect(readSession()).resolves.toMatchObject({ userId: "agent", membership: null });
  });
});
