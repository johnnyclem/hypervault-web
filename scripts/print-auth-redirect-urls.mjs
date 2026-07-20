#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function portfolioDomains() {
  const src = readFileSync(join(root, "lib/domains.ts"), "utf8");
  const block = src.slice(src.indexOf("DOMAIN_PORTFOLIO"));
  return [...block.matchAll(/domain:\s*"([^"]+)"/g)].map((m) => m[1]);
}

function activeBaseDomains() {
  const fromEnv = (process.env.NEXT_PUBLIC_VANITY_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  return fromEnv.length > 0 ? fromEnv : portfolioDomains();
}

const bases = activeBaseDomains();
const urls = ["http://localhost:3000/**"];
for (const base of bases) {
  urls.push(`https://${base}/**`);
  urls.push(`https://*.${base}/**`);
}

console.log(urls.join("\n"));
console.error(`\n${urls.length} redirect URLs for ${bases.length} base domains.`);
