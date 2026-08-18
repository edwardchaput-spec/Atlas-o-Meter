import { readFile } from "node:fs/promises";

import sharp from "sharp";

const icons = [
  { source: "public/icon.svg", target: "public/icon-192.png", size: 192 },
  { source: "public/icon.svg", target: "public/icon-512.png", size: 512 },
  {
    source: "public/maskable-icon.svg",
    target: "public/maskable-icon-512.png",
    size: 512,
  },
];

await Promise.all(
  icons.map(async ({ source, target, size }) => {
    const svg = await readFile(source);
    await sharp(svg).resize(size, size).png().toFile(target);
  }),
);

console.log(`Generated ${icons.length} Atlas-o-meter app icons.`);
