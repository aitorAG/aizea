import { chromium } from "playwright";
const COURSE = "ff340bd3-a4d6-457d-95a4-44845989f27d";
const b = await chromium.launch(); const p = await b.newPage();
p.setDefaultTimeout(30000);

// Tree page - what does it show?
await p.goto(`http://localhost:3100/courses/${COURSE}/tree`, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
await p.waitForTimeout(2000);
const treeText = (await p.evaluate(() => document.body.innerText.substring(0, 400)).catch(() => "error"));
console.log("TREE PAGE TEXT:", treeText);

// Take screenshot
await p.screenshot({ path: "C:/Users/PC/Proyectos/AIzea/aizea/.omo/evidence/v1.7/verify-tree.png" });

// Check all buttons
const allBtns = await p.evaluate(() => {
  return Array.from(document.querySelectorAll("button")).map(b => b.textContent?.substring(0, 40) || "(empty)");
});
console.log("ALL BUTTONS:", allBtns.slice(0, 20));

// Slides page
await p.goto(`http://localhost:3100/courses/${COURSE}/slides`, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
await p.waitForTimeout(2000);
const slidesText = (await p.evaluate(() => document.body.innerText.substring(0, 300)).catch(() => "error"));
console.log("SLIDES PAGE TEXT:", slidesText);

// Any data-depth elements?
const dataEls = await p.evaluate(() => document.querySelectorAll("[data-depth]").length);
console.log("DATA-DEPTH elements:", dataEls);

await b.close();
