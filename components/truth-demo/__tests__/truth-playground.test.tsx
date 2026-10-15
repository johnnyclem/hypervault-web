/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TruthPlayground, statusLabel } from "../truth-playground";

afterEach(cleanup);

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));

describe("TruthPlayground", () => {
  it("reads contested as under appeal", () => {
    expect(statusLabel("contested")).toBe("under appeal");
    expect(statusLabel("active")).toBe("active");
  });

  it("plays the story and shows what the model sees", () => {
    render(<TruthPlayground />);
    expect(screen.getByTestId("context-block").textContent).toContain("(nothing held yet)");
    click("Start");
    expect(screen.getByTestId("story-what").textContent).toContain("You assert a TB");
    expect(screen.getByTestId("context-block").textContent).toContain("[TB] LOG_BUDGET is 100, not 30. (signed: johnny)");
    click(/Next act \(2\/9\)/);
    expect(screen.getByTestId("context-block").textContent).toContain("[UV — UNVERIFIED] The retry cap is read once");
    click(/Next act \(3\/9\)/);
    expect(screen.getAllByTestId("entry-UV")[0].textContent).toContain("still needs a human approval");
    click(/Next act \(4\/9\)/);
    expect(screen.getByTestId("context-block").textContent).toContain("[TB] The retry cap is read once, at start-up. (signed: johnny)");
    click(/Next act \(5\/9\)/);
    expect(screen.getByTestId("context-block").textContent).toContain("[TB ⚠ UNDER APPEAL] LOG_BUDGET is 100, not 30.");
    expect(screen.getByTestId("docket").textContent).toContain("APPEAL");
    click(/Next act \(6\/9\)/);
    expect(screen.getByTestId("events").textContent).toContain("upheld");
    click(/Next act \(7\/9\)/);
    click(/Next act \(8\/9\)/);
    expect(screen.getByTestId("docket").textContent).toContain("NOMINATED");
    expect(screen.getByTestId("context-block").textContent).toContain("[UV · CORROBORATED] Billing runs nightly");
    click(/Next act \(9\/9\)/);
    expect(screen.getByTestId("events").textContent).toContain("undermined");
    expect(screen.getByTestId("context-block").textContent).not.toContain("A sixth retry never happens.");
    expect(screen.getByRole("button", { name: "The end" })).toBeTruthy();
    click("Reset");
    expect(screen.getByTestId("context-block").textContent).toContain("(nothing held yet)");
  });

  it("refuses an agent's TB and a person refuting their own TB's appeal", () => {
    render(<TruthPlayground />);
    // as an agent, the TB toggle is disabled and the form writes a UV
    click(/agent:claude/);
    expect((screen.getByRole("button", { name: /TB · truth/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("assertion"), { target: { value: "The build is green." } });
    fireEvent.change(screen.getByLabelText("basis"), { target: { value: "CI said so" } });
    click("Assert UV");
    expect(screen.getByTestId("context-block").textContent).toContain("[UV — UNVERIFIED] The build is green. — basis: CI said so");
    // the drafter cannot approve
    click("Approve with evidence");
    expect(screen.getByTestId("notice").textContent).toContain("The rule said no.");
    expect(screen.getByTestId("notice").textContent).toContain("cannot approve it");
    // a person asserts a TB, an agent appeals it, the person cannot refute the appeal
    click(/johnny/);
    fireEvent.change(screen.getByLabelText("claim"), { target: { value: "The cap is 5." } });
    click("Assert TB");
    expect(screen.getByTestId("context-block").textContent).toContain("[TB] The cap is 5. (signed: johnny)");
    const tb = screen.getAllByTestId("entry-TB")[0];
    fireEvent.click(within(tb).getByRole("button", { name: "Contest" }));
    click(/agent:gemini/);
    fireEvent.change(screen.getByLabelText("assertion"), { target: { value: "The cap is 6." } });
    click("Assert UV");
    expect(screen.getByTestId("context-block").textContent).toContain("[TB ⚠ UNDER APPEAL] The cap is 5.");
    click(/johnny/);
    const appeal = screen.getAllByTestId("entry-UV")[0];
    fireEvent.click(within(appeal).getByRole("button", { name: "Refute" }));
    expect(screen.getByTestId("notice").textContent).toContain("contempt of corpus");
    // but can strike it, with an opinion, which upholds the TB
    fireEvent.click(within(appeal).getByRole("button", { name: "Strike" }));
    expect(screen.getByTestId("notice").textContent).toContain("A ruling carries an opinion");
    fireEvent.change(within(appeal).getByLabelText(/opinion for/), { target: { value: "A stale branch." } });
    fireEvent.click(within(appeal).getByRole("button", { name: "Strike" }));
    expect(screen.getByTestId("context-block").textContent).toContain("[TB] The cap is 5. (signed: johnny)");
    expect(screen.getByTestId("events").textContent).toContain("upheld");
  });

  it("warns on a retired value and traces a claim", async () => {
    render(<TruthPlayground />);
    click("Start");
    expect(screen.getByTestId("warnings").textContent).toContain("“30” for LOG_BUDGET is retired (now 100)");
    fireEvent.change(screen.getByLabelText("draft"), { target: { value: "LOG_BUDGET went from 30 to 100." } });
    expect(screen.getByTestId("warnings").textContent).toContain("No retired values");
    click("Trace");
    expect(screen.getByTestId("trace").textContent).toContain("Rests on nothing");
    expect(await screen.findByText(/"schemaVersion":2/)).toBeTruthy();
  });

  it("the spotlight variant keeps the story and the ledger but not the form", () => {
    render(<TruthPlayground variant="spotlight" />);
    expect(screen.queryByLabelText("claim")).toBeNull();
    expect(screen.queryByTestId("docket")).toBeNull();
    click("Start");
    expect(screen.getAllByTestId("entry-TB")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Trace" })).toBeNull();
  });
});
