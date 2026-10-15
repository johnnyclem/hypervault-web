/** @vitest-environment happy-dom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DomainLanding } from "../domain-landing";
import { DEFAULT_THEME } from "@/lib/themes";

afterEach(cleanup);

describe("DomainLanding", () => {
  it("features the truth ledger right after the hero, in the nav and the footer", () => {
    render(<DomainLanding domain="vault.cool" brand="HyperVault" theme={DEFAULT_THEME} user={null} />);
    const spotlight = screen.getByTestId("truth-spotlight");
    expect(spotlight.textContent).toContain("Truth Ledger v2");
    expect(spotlight.querySelector('[data-testid="truth-playground"]')).toBeTruthy();
    const main = document.querySelector("main")!;
    expect(main.children[1]).toBe(spotlight);
    const truthLinks = screen.getAllByRole("link").filter((a) => a.getAttribute("href") === "/truth");
    expect(truthLinks.length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole("link", { name: /Try the truth ledger/ }).getAttribute("href")).toBe("#truth");
  });
});
