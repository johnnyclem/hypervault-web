import { beforeEach, describe, expect, it, vi } from "vitest";

const responses: { data: Record<string, unknown> | null; error: { message: string } | null; client: boolean } = {
  data: null,
  error: null,
  client: true,
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () =>
    responses.client
      ? {
          from: () => {
            const chain: Record<string, unknown> = {};
            chain.select = () => chain;
            chain.eq = () => chain;
            chain.maybeSingle = async () => ({ data: responses.data, error: responses.error });
            return chain;
          },
        }
      : null,
}));

import { dashboardWrapperClass, getDashboardTheme } from "@/lib/dashboard-theme";

beforeEach(() => {
  responses.data = null;
  responses.error = null;
  responses.client = true;
});

describe("dashboardWrapperClass", () => {
  it("wraps known styles in their theme class plus .lp", () => {
    expect(dashboardWrapperClass("cyberpunk")).toBe("theme-cyber lp");
    expect(dashboardWrapperClass("modern-dark")).toBe("theme-hypervault lp");
  });

  it("keeps the stock look for unset or unknown ids", () => {
    expect(dashboardWrapperClass(null)).toBeNull();
    expect(dashboardWrapperClass(undefined)).toBeNull();
    expect(dashboardWrapperClass("not-a-style")).toBeNull();
  });
});

describe("getDashboardTheme", () => {
  it("resolves the saved profiles.theme into a wrapper class", async () => {
    responses.data = { theme: "vaporwave" };
    expect(await getDashboardTheme("user-1")).toEqual({ themeId: "vaporwave", wrapperClass: "theme-vapor lp" });
  });

  it("returns the stock look when no theme is saved", async () => {
    responses.data = { theme: null };
    expect(await getDashboardTheme("user-1")).toEqual({ themeId: null, wrapperClass: null });
  });

  it("degrades to the stock look on a database that predates migration 0015", async () => {
    responses.error = { message: 'column profiles.theme does not exist' };
    expect(await getDashboardTheme("user-1")).toEqual({ themeId: null, wrapperClass: null });
  });

  it("degrades to the stock look without a Supabase client", async () => {
    responses.client = false;
    expect(await getDashboardTheme("user-1")).toEqual({ themeId: null, wrapperClass: null });
  });
});
