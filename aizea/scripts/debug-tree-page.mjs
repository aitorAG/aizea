import { chromium } from "playwright";
const COURSE = "ff340bd3-a4d6-457d-95a4-44845989f27d";
const b = await chromium.launch(); const p = await b.newPage();
p.setDefaultTimeout(30000);

// 1. Tree page - check buttons
await p.goto("http://localhost:3100/courses/" + COURSE + "/tree", { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
await p.waitForTimeout(3000);
const edit = await p.locator('button:has-text("Editar")').count().catch(() => 0);
const fs = await p.locator('[data-testid="toggle-fullscreen"]').count().catch(() => 0);
const treeText = (await p.evaluate(() => document.body.innerText.substring(0, 200)).catch(() => "err"));
console.log("TREE:", {edit, fs, text: treeText});

// 2. Slides page - check depth + buttons
await p.goto("http://localhost:3100/courses/" + COURSE + "/slides", { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
await p.waitForTimeout(2000);
const depth = await p.locator("[data-depth]").count().catch(() => 0);
const gc = await p.locator('button:has-text("Generar contenidos")').count().catch(() => 0);
const gt = await p.locator('button:has-text("Generar todo")').count().catch(() => 0);
console.log("SLIDES:", {depth, gc, gt});

await b.close();