/**
 * 布局审计 + 控制台回传/一键修复闭环验证
 * 用法：node scripts/audit.mjs [baseUrl]
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.argv[2] || "http://localhost:3210";
const OUT = path.join(process.cwd(), "scripts", ".shots");
const EDGE =
  process.env.EDGE || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--lang=zh-CN"],
  defaultViewport: { width: 1440, height: 900 },
});

try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(1000);

  /* ---------- 1. 布局审计 ---------- */
  const layout = await page.evaluate(() => {
    const g = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x) };
    };
    return {
      viewport: [window.innerWidth, window.innerHeight],
      work: getComputedStyle(document.querySelector(".work")).gridTemplateColumns,
      sidebar: g(".sidebar"),
      chat: g(".chat"),
      preview: g(".preview"),
      hScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
      bg: getComputedStyle(document.body).backgroundColor,
      font: getComputedStyle(document.body).fontFamily.slice(0, 40),
    };
  });
  log("布局 @1440:", JSON.stringify(layout));

  /* ---------- 2. 打开最近项目（历史恢复） ---------- */
  const projects = await page.evaluate(() => document.querySelectorAll(".project-item").length);
  log("侧栏项目数:", projects);
  if (projects > 0) {
    await page.click(".project-item");
    await sleep(1500);
    const restored = await page.evaluate(() => ({
      msgs: document.querySelectorAll(".agent-card").length,
      iframe: !!document.querySelector(".stage iframe"),
      lines: document.querySelectorAll(".codeview .ln").length,
    }));
    log("历史项目恢复:", JSON.stringify(restored));
  }

  /* ---------- 3. 控制台回传测试：在 iframe 内制造报错 ---------- */
  const frame = page.frames().find((f) => f.parentFrame() === page.mainFrame());
  if (!frame) throw new Error("没有预览 iframe");
  const hooked = await frame.evaluate(() => !!document.querySelector("script[data-atoms-hook]"));
  log("沙箱注入 hook:", hooked);
  await frame.evaluate(() => {
    console.error("模拟运行时错误：Cannot read properties of undefined (reading 'length')");
    throw new Error("");
  }).catch(() => {});
  await sleep(800);

  const consoleState = await page.evaluate(() => {
    const tab = [...document.querySelectorAll(".tab")].find((t) => t.textContent.includes("控制台"));
    tab?.click();
    return { badge: tab?.querySelector(".badge")?.textContent ?? null };
  });
  await sleep(600);
  const consoleRows = await page.evaluate(() =>
    [...document.querySelectorAll(".console-row")].map((r) => r.className + " | " + r.textContent.slice(0, 90)),
  );
  log("控制台错误角标:", consoleState.badge);
  log("控制台条目:", consoleRows.length ? consoleRows : "（空）");
  const fixEnabled = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("让 Agent 修复"));
    return b ? !b.disabled : null;
  });
  log("「让 Agent 修复」可用:", fixEnabled);
  await page.screenshot({ path: path.join(OUT, "08-console-error.png") });

  /* ---------- 4. 一键修复闭环（真实模型调用） ---------- */
  if (fixEnabled) {
    log("→ 触发修复，等待新版本…");
    const before = await page.evaluate(() => document.querySelectorAll(".vchip").length);
    const t = Date.now();
    await page.evaluate(() => {
      [...document.querySelectorAll("button")].find((x) => x.textContent.includes("让 Agent 修复"))?.click();
    });
    await page.waitForFunction(
      (n) => document.querySelectorAll(".vchip").length > n,
      { timeout: 180000 },
      before,
    );
    const after = await page.evaluate(() => ({
      chips: [...document.querySelectorAll(".vchip")].map((c) => c.textContent),
      steps: [...document.querySelectorAll(".step")].map((s) => s.className.replace("step ", "") + ":" + s.textContent.slice(0, 42)),
    }));
    log(`✓ 修复完成 ${((Date.now() - t) / 1000).toFixed(1)}s，版本:`, after.chips.join(", "));
    log("  步骤:", after.steps.join(" / "));
    await sleep(1200);
    await page.screenshot({ path: path.join(OUT, "09-fixed.png") });
  }

  /* ---------- 5. 刷新后持久化恢复 ---------- */
  await page.reload({ waitUntil: "networkidle2" });
  await sleep(1200);
  const afterReload = await page.evaluate(() => ({
    projects: document.querySelectorAll(".project-item").length,
    versionsInFirst: document.querySelector(".pj-meta")?.textContent ?? "",
  }));
  log("刷新后侧栏:", JSON.stringify(afterReload));

  /* ---------- 6. 窄屏布局 ---------- */
  await page.setViewport({ width: 390, height: 844, isMobile: true });
  await sleep(900);
  const narrow = await page.evaluate(() => ({
    hScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
    sw: document.documentElement.scrollWidth,
    vw: window.innerWidth,
    switchVisible: !!document.querySelector(".mobile-switch")?.offsetParent,
  }));
  log("布局 @390:", JSON.stringify(narrow));
  await page.screenshot({ path: path.join(OUT, "10-narrow.png") });

  log("\n页面 JS 错误:", pageErrors.length ? pageErrors : "无");
} finally {
  await browser.close();
}
