import { chromium } from "playwright";

const b = await chromium.launch();
const ctx = await b.newContext();
const p = await ctx.newPage();
p.setDefaultTimeout(60000);
const r = [];
const OPTS = { waitUntil: "networkidle", timeout: 60000 };
const COURSE = "eb18c671-5184-4461-b01e-c0cf800cccb6";

// 2.7 Edit button exists
await p.goto("http://localhost:3100/courses/" + COURSE + "/tree", OPTS).catch(() => {});
await p.waitForTimeout(3000);
const editBtn = await p.locator('[aria-label*="Editar nodo"]').count();
r.push({ f: "2.7 Edit btn", ok: editBtn > 0, detail: "count=" + editBtn });

// 2.8 Fullscreen button exists
const fsBtn = await p.locator('[data-testid="toggle-fullscreen"]').count();
r.push({ f: "2.8 Fullscreen btn", ok: fsBtn > 0, detail: "count=" + fsBtn });

// 3.1 Slides hierarchy depth
await p.goto("http://localhost:3100/courses/" + COURSE + "/slides", OPTS).catch(() => {});
await p.waitForTimeout(2000);
const depth = await p.locator("[data-depth]").first().getAttribute("data-depth").catch(() => null);
r.push({ f: "3.1 Slides depth", ok: depth !== null, detail: "depth=" + (depth || "null") });

// 4.1 Single column layout (no 2-col grid)
await p.goto("http://localhost:3100/courses/" + COURSE + "/slides/ef331899-b3b1-46ef-bcd9-0852f5f8fc21", OPTS).catch(() => {});
await p.waitForTimeout(2000);
const grid = await p.locator('[class*="grid-cols-"]').count();
r.push({ f: "4.1 No 2-col grid", ok: grid === 0, detail: "2col-grids=" + grid });

// 2.2 Banner on tree page
await p.goto("http://localhost:3100/courses/" + COURSE + "/tree", OPTS).catch(() => {});
await p.waitForTimeout(2000);
const banner = await p.locator('[data-testid*="pipeline"]').count().catch(() => 0);
r.push({ f: "2.2 Banner on tree", ok: banner > 0, detail: "count=" + banner });

console.log(JSON.stringify(r, null, 2));
await b.close();
