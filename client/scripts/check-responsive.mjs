/** 响应式细节检查：窄屏下 tab 切换器 / 侧栏 / 溢出 */
import puppeteer from "puppeteer-core";

const BASE = process.argv[2] || "http://localhost:3210";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--no-sandbox"],
  defaultViewport: { width: 390, height: 844, isMobile: true },
});
const page = await browser.newPage();
await page.goto(BASE, { waitUntil: "networkidle2" });
await sleep(1200);

const info = await page.evaluate(() => {
  const sw = document.querySelector(".mobile-switch");
  const chat = document.querySelector(".chat");
  const preview = document.querySelector(".preview");
  const side = document.querySelector(".sidebar");
  const rect = sw.getBoundingClientRect();
  return {
    switchDisplay: getComputedStyle(sw).display,
    switchBox: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width)],
    chatDisplay: getComputedStyle(chat).display,
    previewDisplay: getComputedStyle(preview).display,
    sidebarDisplay: getComputedStyle(side).display,
    hScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
});
console.log("窄屏 390:", JSON.stringify(info));

// 点击"预览"切换
await page.evaluate(() => {
  [...document.querySelectorAll(".mobile-switch button")].find((b) => b.textContent.includes("预览"))?.click();
});
await sleep(500);
const after = await page.evaluate(() => ({
  chat: getComputedStyle(document.querySelector(".chat")).display,
  preview: getComputedStyle(document.querySelector(".preview")).display,
}));
console.log("切换后:", JSON.stringify(after));
await page.screenshot({ path: "scripts/.shots/11-narrow-preview.png" });

// 侧栏抽屉
await page.evaluate(() => document.querySelector(".sidebar-toggle")?.click());
await sleep(400);
const drawer = await page.evaluate(() => getComputedStyle(document.querySelector(".sidebar")).display);
console.log("侧栏抽屉:", drawer);
await page.screenshot({ path: "scripts/.shots/12-narrow-drawer.png" });

await browser.close();
