// LIN-107: renders public/og-image.png (1200x630) from the Linda brand
// tokens using the repo's existing Playwright Chromium — no paid tooling.
// Run: node scripts/generate-og-image.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = `${here}/../public/og-image.png`;
mkdirSync(`${here}/../public`, { recursive: true });

// Colours mirror src/app/styles/tokens.css (linda-*/ink-* scales).
const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; overflow: hidden; }
  body {
    font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
    background: linear-gradient(135deg, #112e27 0%, #1d5244 60%, #246754 100%);
    color: #ffffff;
    display: flex; flex-direction: column; justify-content: center;
    padding: 0 96px;
    position: relative;
  }
  .glyph {
    position: absolute; top: -180px; right: -180px;
    width: 560px; height: 560px; border-radius: 50%;
    background: radial-gradient(circle, rgba(168,215,201,.28), rgba(168,215,201,0) 70%);
  }
  .brand { font-size: 30px; font-weight: 600; letter-spacing: .32em;
    color: #a8d7c9; text-transform: uppercase; margin-bottom: 28px; }
  h1 { font-size: 92px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.05;
    margin-bottom: 30px; }
  h1 .accent { color: #a8d7c9; }
  .tagline { font-size: 38px; font-weight: 400; color: #d3ebe4; margin-bottom: 54px; }
  .pills { display: flex; gap: 14px; flex-wrap: wrap; }
  .pill { font-size: 24px; font-weight: 500; color: #eef7f4;
    border: 1.5px solid rgba(168,215,201,.55); border-radius: 999px; padding: 10px 26px; }
</style></head>
<body>
  <div class="glyph"></div>
  <div class="brand">Linda</div>
  <h1>Your AI coworkers,<br><span class="accent">onboarded by themselves.</span></h1>
  <div class="tagline">Hire agents that run your ops end to end.</div>
  <div class="pills">
    <span class="pill">Calls</span><span class="pill">Marketing</span><span class="pill">Sales</span>
    <span class="pill">Finance</span><span class="pill">Legal</span><span class="pill">Hiring</span>
  </div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'networkidle' });
const png = await page.screenshot({ type: 'png' });
await browser.close();
writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
