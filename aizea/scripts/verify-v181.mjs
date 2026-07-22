import { chromium } from "playwright";
const COURSE = "70eabd48-fb57-4e9c-af77-2668969941e0";
const b = await chromium.launch(); const p = await b.newPage();
p.setDefaultTimeout(30000);
const r = [];

// 1. Create course + navigate (no chunk error)
await p.goto("http://localhost:3100/", { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
await p.waitForTimeout(2000);
const homeOk = (await p.evaluate(() => document.body.innerText.length > 50).catch(() => false));
r.push({ f: "Homepage loads", ok: homeOk });

// 2. Upload test
await p.goto("http://localhost:3100/courses/" + COURSE + "/materials", { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
await p.waitForTimeout(2000);
const pageOk = await p.evaluate(() => document.body.innerText.includes("Materiales")).catch(() => false);
r.push({ f: "Materials page loads", ok: pageOk });

// 3. Slides page loads
await p.goto("http://localhost:3100/courses/" + COURSE + "/slides", { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
await p.waitForTimeout(2000);
const slidesOk = await p.evaluate(() => {
  const t = document.body.innerText;
  return t.includes("Slide") || t.includes("Diapositiva") || t.includes("Generar");
}).catch(() => false);
r.push({ f: "Slides page loads", ok: slidesOk });

// 4. Slide detail (no module error)
const slideHtml = await p.evaluate(() => {
  const links = Array.from(document.querySelectorAll("a[href*='slides/']"));
  return links[0]?.getAttribute("href") || null;
}).catch(() => null);
if (slideHtml) {
  await p.goto("http://localhost:3100/" + slideHtml, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(2000);
  const detailOk = await p.evaluate(() => {
    return !document.body.innerText.includes("Application error") && !document.body.innerText.includes("404");
  }).catch(() => false);
  r.push({ f: "Slide detail loads", ok: detailOk });
}

console.log(JSON.stringify(r, null, 2));
await b.close();
