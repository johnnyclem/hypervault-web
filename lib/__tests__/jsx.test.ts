import { describe, expect, it } from "vitest";
import { detectJsx, prepareJsxForBrowser, wrapJsxAsHtml } from "@/lib/jsx";

describe("detectJsx", () => {
  it("detects a bare React component with hooks", () => {
    const code = `
import { useState } from "react";
export default function Counter() {
  const [n, setN] = useState(0);
  return <button onClick={() => setN(n + 1)}>{n}</button>;
}`;
    const result = detectJsx(code);
    expect(result.isJsx).toBe(true);
    expect(result.confidence).toBeGreaterThan(50);
  });

  it("detects an arrow-function component with className", () => {
    const code = `const App = () => (
  <div className="p-4">
    <Header title="hi" />
  </div>
);
export default App;`;
    expect(detectJsx(code).isJsx).toBe(true);
  });

  it("never flags a full HTML document, even one that mentions React", () => {
    const html = `<!DOCTYPE html>
<html><head><script src="https://unpkg.com/react@18/umd/react.production.min.js"></script></head>
<body><div id="root"></div></body></html>`;
    const result = detectJsx(html);
    expect(result.isJsx).toBe(false);
    expect(result.signals).toContain("full HTML document");
  });

  it("does not flag plain HTML fragments", () => {
    expect(detectJsx(`<div class="card"><p>Hello world</p></div>`).isJsx).toBe(false);
  });

  it("does not flag plain prose", () => {
    expect(detectJsx("Here is the report you asked for. Revenue is up 4%.").isJsx).toBe(false);
  });
});

describe("prepareJsxForBrowser", () => {
  it("keeps imports/exports intact for the in-browser commonjs transform", () => {
    const { code, mountExpr } = prepareJsxForBrowser(
      `import React from "react";\nimport { Card } from "@/components/ui/card"; // shadcn\nexport default function App() { return <Card>hi</Card>; }`
    );
    expect(code).toContain(`import React from "react"`);
    expect(code).toContain(`import { Card } from "@/components/ui/card"`);
    expect(code).toContain("export default function App()");
    expect(mountExpr).toContain("App");
  });

  it("names an explicitly named default export for the mount fallback", () => {
    const { mountExpr } = prepareJsxForBrowser(
      `function helper() {}\nexport default function ImportTelemetry({ importId }) { return <p>hi</p>; }`
    );
    expect(mountExpr).toContain("ImportTelemetry");
  });

  it("strips markdown code fences", () => {
    const { code } = prepareJsxForBrowser("```jsx\nfunction App() { return <p>hi</p>; }\n```");
    expect(code).not.toContain("```");
    expect(code).toContain("function App()");
  });

  it("extracts fenced code and drops surrounding prose", () => {
    const { code } = prepareJsxForBrowser(
      "Here's your component:\n\n```jsx\nfunction App() { return <p>hi</p>; }\n```\nLet me know if you want changes!"
    );
    expect(code).not.toContain("Here's your component");
    expect(code).not.toContain("Let me know");
    expect(code).toContain("function App()");
  });

  it("strips stray fence markers when fences are unbalanced", () => {
    const { code } = prepareJsxForBrowser("```jsx\nfunction App() { return <p>hi</p>; }");
    expect(code).not.toContain("```");
    expect(code).toContain("function App()");
  });

  it("falls back to the first capitalized component when nothing is exported", () => {
    const { mountExpr } = prepareJsxForBrowser(`function Dashboard() { return <p>hi</p>; }`);
    expect(mountExpr).toContain("Dashboard");
  });

  it("falls back to a capitalized arrow-function component", () => {
    const { mountExpr } = prepareJsxForBrowser(`const Widget = () => <p>hi</p>;`);
    expect(mountExpr).toContain("Widget");
  });
});

describe("wrapJsxAsHtml", () => {
  const wrapped = wrapJsxAsHtml(`function App() { return <p>hi</p>; }`, `My "Cool" <App>`);

  it("produces a full HTML document with CDN scripts and a babel block", () => {
    expect(wrapped).toMatch(/^<!DOCTYPE html>/);
    expect(wrapped).toContain("unpkg.com/react@18");
    expect(wrapped).toContain("babel.min.js");
    expect(wrapped).toContain(`<script type="text/babel"`);
  });

  it("escapes the title", () => {
    expect(wrapped).toContain("My &quot;Cool&quot; &lt;App&gt;");
    expect(wrapped).not.toContain("<App>");
  });

  it("embeds the original source as an escaped fallback", () => {
    expect(wrapped).toContain('id="hv-fallback"');
    expect(wrapped).toContain("function App() { return &lt;p&gt;hi&lt;/p&gt;; }");
  });

  it("neutralizes </script> sequences inside the component code", () => {
    const evil = wrapJsxAsHtml(
      `function App() { return <p>{"</script><script>alert(1)</script>"}</p>; }`,
      "evil"
    );
    const babelBlock = evil.slice(evil.indexOf('type="text/babel"'));
    expect(babelBlock).not.toContain("</script><script>alert(1)");
  });

  it("includes the error + CDN-failure fallback wiring", () => {
    expect(wrapped).toContain("__hvShowError");
    expect(wrapped).toContain("unhandledrejection");
    expect(wrapped).toContain("failed to load from the CDN");
  });

  it("loads Tailwind so utility-classed components aren't unstyled", () => {
    expect(wrapped).toContain("cdn.tailwindcss.com");
  });

  it("no longer injects the Add to Home Screen overlay button", () => {
    expect(wrapped).not.toContain("hv-a2hs");
    expect(wrapped).not.toContain("Add to Home Screen");
    expect(wrapped).not.toContain("beforeinstallprompt");
  });

  it("wires the module shims and the combined react+typescript+commonjs preset", () => {
    expect(wrapped).toContain('data-presets="hypervault"');
    expect(wrapped).toContain('registerPreset("hypervault"');
    expect(wrapped).toContain('availablePlugins["transform-modules-commonjs"]');
    expect(wrapped).toContain("availablePresets.typescript");
    expect(wrapped).toContain("window.require = function");
    expect(wrapped).toContain("window.module = { exports: hvExports }");
  });

  it("prefers a real module default export over the name heuristics when mounting", () => {
    expect(wrapped).toContain("__HvExported.default");
    expect(wrapped).toContain("React.isValidElement(__HvComponent)");
  });

  it("forwards URL query params as props so prop-taking components aren't mounted bare", () => {
    expect(wrapped).toContain("Object.fromEntries(new URLSearchParams(window.location.search))");
    expect(wrapped).toContain("React.createElement(__HvComponent, __HvProps)");
  });

  it("omits the repair link element by default", () => {
    expect(wrapped).not.toContain('id="hv-repair"');
  });

  it("embeds a hidden, error-revealed repair link when a repairUrl is given", () => {
    const withRepair = wrapJsxAsHtml("function App(){ return <p/>; }", "T", {
      repairUrl: "https://app.example/vault?repair=abc",
    });
    expect(withRepair).toContain('id="hv-repair"');
    expect(withRepair).toContain("https://app.example/vault?repair=abc");
    expect(withRepair).toContain("display:none");
    expect(withRepair).toContain('getElementById("hv-repair")');
  });

  it("escapes the repair URL into the href attribute", () => {
    const withRepair = wrapJsxAsHtml("code", "T", {
      repairUrl: 'https://app.example/vault?repair="onx',
    });
    expect(withRepair).not.toContain('repair="onx"');
    expect(withRepair).toContain("&quot;onx");
  });
});
