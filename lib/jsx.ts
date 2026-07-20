
export type JsxDetection = {
  isJsx: boolean;
  confidence: number;
  signals: string[];
};

const STRONG_SIGNALS: Array<[RegExp, string]> = [
  [/\bimport\s+React\b/, "import React"],
  [/\bfrom\s+['"]react(-dom)?(\/[a-z]+)?['"]/, "react import"],
  [/\bReactDOM\b/, "ReactDOM usage"],
  [/\buse(State|Effect|Ref|Memo|Callback|Reducer|Context|LayoutEffect)\s*\(/, "react hook"],
  [/\bexport\s+default\s+(async\s+)?(function|class)\s+[A-Z]/, "export default component"],
];

const WEAK_SIGNALS: Array<[RegExp, string]> = [
  [/\bclassName\s*=/, "className prop"],
  [/<[A-Z][A-Za-z0-9]*[\s/>]/, "capitalized JSX tag"],
  [/=>\s*\(?\s*</, "arrow function returning JSX"],
  [/\breturn\s*\(?\s*</, "return <JSX"],
  [/\b(?:function|const|let|var)\s+[A-Z][\w$]*\s*(?:=\s*(?:\([^)]*\)|[\w$]+)\s*=>|\()/, "capitalized component definition"],
  [/\{\s*[a-zA-Z_$][\w$.]*\s*\}\s*</, "JSX expression"],
  [/\bexport\s+default\b/, "export default"],
];

export function detectJsx(content: string): JsxDetection {
  const sample = content.slice(0, 50_000);
  const trimmed = sample.trimStart();

  if (/^<!doctype\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
    return { isJsx: false, confidence: 0, signals: ["full HTML document"] };
  }

  const signals: string[] = [];
  let score = 0;
  for (const [re, label] of STRONG_SIGNALS) {
    if (re.test(sample)) {
      score += 3;
      signals.push(label);
    }
  }
  for (const [re, label] of WEAK_SIGNALS) {
    if (re.test(sample)) {
      score += 1;
      signals.push(label);
    }
  }

  const isJsx = score >= 3;
  return { isJsx, confidence: Math.min(100, score * 20), signals };
}

function extractFencedCode(content: string): string | null {
  const blocks = Array.from(content.matchAll(/```[\w-]*[ \t]*\n([\s\S]*?)```/g), (m) => m[1]);
  if (blocks.length === 0) return null;
  return blocks.reduce((longest, b) => (b.length > longest.length ? b : longest));
}

export function prepareJsxForBrowser(code: string): { code: string; mountExpr: string } {
  let out = code;

  const fenced = extractFencedCode(out);
  if (fenced !== null) {
    out = fenced;
  } else {
    out = out.replace(/^```[a-z]*\s*\n?/gim, "").replace(/^```\s*$/gim, "");
  }

  const defaultName =
    out.match(/^[ \t]*export\s+default\s+(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/m)?.[1] ??
    out.match(/\bfunction\s+([A-Z][\w$]*)\s*\(/)?.[1] ??
    out.match(/\b(?:const|let|var)\s+([A-Z][\w$]*)\s*=\s*(?:\([^)]*\)|[\w$]+)\s*=>/)?.[1] ??
    out.match(/\bclass\s+([A-Z][\w$]*)\s+extends\s+React/)?.[1] ??
    null;

  const mountExpr = defaultName
    ? `typeof ${defaultName} !== "undefined" ? ${defaultName} : (typeof App !== "undefined" ? App : null)`
    : `typeof App !== "undefined" ? App : null`;

  return { code: out, mountExpr };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function wrapJsxAsHtml(
  rawCode: string,
  title: string,
  opts: { repairUrl?: string } = {}
): string {
  const { code, mountExpr } = prepareJsxForBrowser(rawCode);
  const safeTitle = escapeHtml(title || "HyperVault Artifact");
  const safeSource = escapeHtml(rawCode);
  const safeRepairUrl = opts.repairUrl ? escapeHtml(opts.repairUrl) : "";
  const safeCode = code.replace(/<\/script/gi, "<\\/script");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${safeTitle}</title>
<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/@babel/standalone@7/babel.min.js"></script>
<script src="https://cdn.tailwindcss.com"></script>
<style>
  html, body { margin: 0; padding: 0; min-height: 100%; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  #hv-error { display: none; margin: 24px; padding: 16px; border-radius: 12px; background: #fef2f2;
    color: #991b1b; font-family: ui-monospace, monospace; white-space: pre-wrap; }
  #hv-fallback { display: none; margin: 24px; }
  #hv-fallback summary { cursor: pointer; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 14px; }
  #hv-fallback pre { overflow-x: auto; padding: 16px; border-radius: 12px; background: #f4f4f5;
    color: #18181b; font-size: 12px; line-height: 1.5; }
</style>
</head>
<body>
<div id="root"></div>
<div id="hv-error"></div>
${safeRepairUrl ? `<a id="hv-repair" href="${safeRepairUrl}" style="display:none;margin:0 24px 8px;font-family:ui-sans-serif,system-ui,sans-serif;font-size:14px;font-weight:600;color:#2563eb;text-decoration:none">🔧 Try an automatic repair →</a>` : ""}
<details id="hv-fallback">
  <summary>View the original source of this artifact</summary>
  <pre>${safeSource}</pre>
</details>
<script>
(function () {
  function showError(message) {
    var el = document.getElementById("hv-error");
    el.style.display = "block";
    el.textContent = "This artifact hit a snag rendering:\\n" + message;
    document.getElementById("hv-fallback").style.display = "block";
    var repair = document.getElementById("hv-repair");
    if (repair) {
      repair.style.display = "inline-block";
      if (!repair.dataset.hvErrorSet) {
        repair.dataset.hvErrorSet = "1";
        try {
          var url = new URL(repair.getAttribute("href"), window.location.href);
          url.searchParams.set("error", String(message).slice(0, 1500));
          repair.setAttribute("href", url.toString());
        } catch (e) {}
      }
    }
  }
  window.__hvShowError = showError;
  window.addEventListener("error", function (e) {
    showError(e.message || e.error || "Unknown error");
  });
  window.addEventListener("unhandledrejection", function (e) {
    showError((e.reason && e.reason.message) || e.reason || "Unhandled promise rejection");
  });
  window.addEventListener("load", function () {
    if (!window.React || !window.ReactDOM || !window.Babel) {
      showError("React/Babel failed to load from the CDN. Check your connection and reload.");
    }
  });

  var reactGlobals = ["useState","useEffect","useRef","useMemo","useCallback","useReducer",
    "useContext","useLayoutEffect","useId","useTransition","useDeferredValue",
    "useImperativeHandle","useSyncExternalStore","useInsertionEffect","startTransition",
    "Fragment","createContext","forwardRef","memo","lazy","Component","PureComponent",
    "createRef","Suspense","StrictMode","createElement","cloneElement","Children"];
  for (var i = 0; i < reactGlobals.length; i++) {
    var name = reactGlobals[i];
    if (window.React && !(name in window)) window[name] = window.React[name];
  }

  var hvExports = {};
  window.exports = hvExports;
  window.module = { exports: hvExports };

  var stubComponents = {};
  function stubComponent(key) {
    if (!stubComponents[key]) {
      stubComponents[key] = function HvStub(props) {
        props = props || {};
        return window.React.createElement("div", props, props.children);
      };
    }
    return stubComponents[key];
  }
  function iconComponent(key) {
    if (!stubComponents[key]) {
      stubComponents[key] = function HvIcon(props) {
        props = props || {};
        var size = props.size || 24;
        return window.React.createElement(
          "svg",
          { width: size, height: size, viewBox: "0 0 24 24", fill: "none",
            stroke: "currentColor", strokeWidth: 2, className: props.className, style: props.style,
            "aria-hidden": true },
          window.React.createElement("circle", { cx: 12, cy: 12, r: 9 })
        );
      };
    }
    return stubComponents[key];
  }
  function classJoiner() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) {
      var a = arguments[i];
      if (typeof a === "string" || typeof a === "number") out.push(a);
      else if (Array.isArray(a)) out.push(classJoiner.apply(null, a));
      else if (a && typeof a === "object") { for (var k in a) { if (a[k]) out.push(k); } }
    }
    return out.filter(Boolean).join(" ");
  }
  var stubModules = {};
  function stubModule(spec) {
    if (!stubModules[spec]) {
      var icons = /lucide|icons?/i.test(spec);
      stubModules[spec] = new Proxy({}, {
        get: function (_t, prop) {
          if (typeof prop !== "string") return undefined;
          if (prop === "__esModule") return true;
          if (prop === "default") return stubComponent(spec + "#default");
          if (icons || /^[A-Z]/.test(prop)) {
            return icons ? iconComponent(spec + "#" + prop) : stubComponent(spec + "#" + prop);
          }
          return classJoiner;
        }
      });
    }
    return stubModules[spec];
  }
  window.require = function (spec) {
    var name = String(spec);
    if (name === "react" || name.indexOf("react/") === 0) return window.React;
    if (name === "react-dom" || name.indexOf("react-dom/") === 0) return window.ReactDOM;
    return stubModule(name);
  };

  if (window.Babel) {
    window.Babel.registerPreset("hypervault", {
      presets: [
        window.Babel.availablePresets.react,
        [window.Babel.availablePresets.typescript, { isTSX: true, allExtensions: true }]
      ],
      plugins: [window.Babel.availablePlugins["transform-modules-commonjs"]]
    });
  }
})();
</script>
<script type="text/babel" data-presets="hypervault">
${safeCode}

let __HvComponent = ${mountExpr};
const __HvExported = (window.module && window.module.exports) || {};
if (__HvExported.default != null) __HvComponent = __HvExported.default;
else if (typeof __HvExported === "function") __HvComponent = __HvExported;
if (__HvComponent) {
  try {
    let __HvProps = {};
    try { __HvProps = Object.fromEntries(new URLSearchParams(window.location.search)); } catch (_) {}
    const __HvNode = React.isValidElement(__HvComponent)
      ? __HvComponent
      : React.createElement(__HvComponent, __HvProps);
    ReactDOM.createRoot(document.getElementById("root")).render(__HvNode);
  } catch (err) {
    window.__hvShowError((err && err.message) || String(err));
  }
} else {
  window.__hvShowError(
    "HyperVault couldn't find a component to render. Define one like: function App() { ... }"
  );
}
</script>
</body>
</html>
`;
}
