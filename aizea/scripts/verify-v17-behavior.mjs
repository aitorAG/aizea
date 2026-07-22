import { chromium } from "playwright";
const COURSE = "ff340bd3-a4d6-457d-95a4-44845989f27d";
const b = await chromium.launch(); const p = await b.newPage();
p.setDefaultTimeout(30000);
const r = [];

// 2.6 Recentrar removed
await p.goto(`http://localhost:3100/courses/${COURSE}/tree`, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
await p.waitForTimeout(2000);
const rc = await p.locator('button:has-text("Recentrar")').count().catch(() => 0);
r.push({ f: "2.6 Recentrar gone", ok: rc === 0, detail: "count=" + rc });

// 2.5 Generar diapositivas in toolbar
const gd = await p.locator('button:has-text("Generar diapositivas")').count().catch(() => 0);
r.push({ f: "2.5 Generar diapos btn", ok: gd > 0, detail: "count=" + gd });

// 2.1 Fullscreen button
const fs = await p.locator('[data-testid="toggle-fullscreen"]').count().catch(() => 0);
r.push({ f: "2.1 Fullscreen btn", ok: fs > 0, detail: "count=" + fs });

// 3.1 Slides hierarchy
await p.goto(`http://localhost:3100/courses/${COURSE}/slides`, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
await p.waitForTimeout(2000);
const depth = await p.locator("[data-depth]").count().catch(() => 0);
const root = await p.locator('[data-testid="slides-tree-root"]').count().catch(() => 0);
r.push({ f: "3.1 Hierarchy depth", ok: depth > 0, detail: "depth=" + depth });
r.push({ f: "3.1 Tree root el", ok: root > 0, detail: "root=" + root });

// 3.2 Export buttons on slides page
const pdfBtn = await p.locator('button:has-text("Exportar PDF")').count().catch(() => 0);
r.push({ f: "3.2 Export PDF btn", ok: pdfBtn > 0, detail: "count=" + pdfBtn });

console.log(JSON.stringify(r, null, 2));
await b.close();
