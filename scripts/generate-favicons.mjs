// LIN-122: generate Linda brand favicon set.
//
// Renders the mark (linda-600 rounded tile + white "L" drawn as vector
// rects, so no font dependency at build time) into the Next.js App Router
// file conventions — src/app/favicon.ico, apple-icon.png, icon.png —
// which Next auto-serves and auto-injects <link rel="icon"> for.
//
// Usage: node scripts/generate-favicons.mjs   (run from repo root)

import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';

const ACCENT = '#246754'; // --accent / linda-600

// 1024x1024 master. The "L" is two rounded rects (vertical stem + foot),
// bbox centered on the canvas.
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect x="0" y="0" width="1024" height="1024" rx="224" fill="${ACCENT}"/>
  <rect x="350" y="292" width="136" height="440" rx="34" fill="#ffffff"/>
  <rect x="350" y="596" width="324" height="136" rx="34" fill="#ffffff"/>
</svg>`;

// ICO container with PNG payloads (valid since Vista; every current
// browser accepts PNG frames inside .ico).
function ico(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);
  const entries = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  pngs.forEach((png, i) => {
    const base = i * 16;
    entries.writeUInt8(png.width >= 256 ? 0 : png.width, base);
    entries.writeUInt8(png.width >= 256 ? 0 : png.width, base + 1);
    entries.writeUInt8(0, base + 2); // palette
    entries.writeUInt8(0, base + 3); // reserved
    entries.writeUInt16LE(1, base + 4); // color planes
    entries.writeUInt16LE(32, base + 6); // bits per pixel
    entries.writeUInt32LE(png.data.length, base + 8);
    entries.writeUInt32LE(offset, base + 12);
    offset += png.data.length;
  });
  return Buffer.concat([header, entries, ...pngs.map((p) => p.data)]);
}

const master = sharp(Buffer.from(svg)).png();
await mkdir('src/app', { recursive: true });

const png = async (size) => ({
  width: size,
  data: await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer(),
});

await writeFile('src/app/favicon.ico', ico(await Promise.all([16, 32, 48].map(png))));
await writeFile('src/app/apple-icon.png', await sharp(Buffer.from(svg)).resize(180, 180).png().toBuffer());
await writeFile('src/app/icon.png', await sharp(Buffer.from(svg)).resize(192, 192).png().toBuffer());

console.log('wrote src/app/favicon.ico, src/app/apple-icon.png, src/app/icon.png');
