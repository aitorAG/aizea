// Generate PWA icons from the existing Tauri icon source.
// Run: node scripts/generate-pwa-icons.cjs
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");

const SOURCE = path.join(__dirname, "..", "src-tauri", "icons", "icon.png");
const OUT_DIR = path.join(__dirname, "..", "public", "icons");

const TARGETS = [
  { name: "pwa-192x192.png", size: 192 },
  { name: "pwa-512x512.png", size: 512 },
  { name: "apple-touch-icon.png", size: 180 },
];

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`[icons] Source icon not found: ${SOURCE}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const t of TARGETS) {
    const out = path.join(OUT_DIR, t.name);
    await sharp(SOURCE)
      .resize(t.size, t.size, {
        fit: "cover",
        position: "center",
        background: { r: 59, g: 130, b: 246, alpha: 1 },
      })
      .png()
      .toFile(out);
    const stat = fs.statSync(out);
    console.log(`[icons] ${t.name} (${t.size}x${t.size}) -> ${stat.size} bytes`);
  }
  console.log("[icons] done");
}

main().catch((err) => {
  console.error("[icons] failed:", err);
  process.exit(1);
});
