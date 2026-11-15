/**
 * 浏览器端 E2E：真实点击 → 生成 → 预览 → 交互 → 截图
 * 用系统自带 Edge（puppeteer-core，无需下载 Chromium）
 * 用法：node scripts/shot.mjs [baseUrl]
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.argv[2] || "http://localhost:3210";
const OUT = path.join(process.cwd(), "scripts", ".shots");
const EDGE =
  process.env.EDGE ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

fs.mkdirSync(OUT, { recursive: true });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--lang=zh-CN"],
  defaultViewport: { width: 1440, height: 900 },
});

try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console.error: " + m.text().slice(0, 200));
  });

  console.log("→ 打开工作台", BASE);
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(600);
  await page.screenshot({ path: path.join(OUT, "01-empty.png") });
  console.log("  ✓ 截图 01-empty.png");

  // 点击第一个模板，触发 Agent 生成
  console.log("→ 点击模板开始生成…");
  await page.click(".tpl");
  await page.waitForSelector(".stage iframe", { timeout: 180000 });
  await sleep(2000);
  await page.screenshot({ path: path.join(OUT, "02-generated.png") });
  console.log("  ✓ 截图 02-generated.png");

  // 校验预览 iframe 内确实是可运行的页面
  const frame = page.frames().find((f) => f !== page.mainFrame() && f.parentFrame() === page.mainFrame());
  const info = await frame.evaluate(() => ({
    title: document.title,
    textLen: (document.body?.innerText || "").length,
    buttons: document.querySelectorAll("button").length,
    inputs: document.querySelectorAll("input,select,textarea").length,
    style: getComputedStyle(document.body).backgroundColor,
  }));
  console.log("  ✓ 预览内页：", JSON.stringify(info));

  // 在生成的应用里真实操作：填表单 → 提交 → 看 localStorage
  const acted = await frame.evaluate(() => {
    const input = document.querySelector("input[type=text],input:not([type]),input[type=number]");
    if (!input) return { ok: false, reason: "没有找到输入框" };
    input.value = input.type === "number" ? "123" : "Atoms 测试项";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const form = document.querySelector("form");
    const btn = document.querySelector("form button, button[type=submit]");
    if (form) form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    else if (btn) btn.click();
    const keys = Object.keys(localStorage);
    const store = {};
    keys.forEach((k) => (store[k] = (localStorage.getItem(k) || "").length));
    return { ok: true, storageKeys: keys, store, bodyLen: document.body.innerText.length };
  });
  console.log("  ✓ 应用内交互：", JSON.stringify(acted));
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, "03-app-interacted.png") });
  console.log("  ✓ 截图 03-app-interacted.png");

  // 代码视图
  const clickTab = async (label) => {
    await page.evaluate((l) => {
      const b = [...document.querySelectorAll(".tab")].find((x) => x.textContent.includes(l));
      if (b) b.click();
    }, label);
    await sleep(500);
  };
  await clickTab("代码");
  const codeLines = await page.evaluate(() => document.querySelectorAll(".codeview .ln").length);
  console.log("  ✓ 代码视图行数：", codeLines);
  await page.screenshot({ path: path.join(OUT, "04-code.png") });

  // 控制台视图
  await clickTab("控制台");
  const consoleRows = await page.evaluate(() => document.querySelectorAll(".console-row").length);
  console.log("  ✓ 控制台条目：", consoleRows);
  await page.screenshot({ path: path.join(OUT, "05-console.png") });

  // 回到预览 + 手机视图
  await clickTab("预览");
  await page.evaluate(() => {
    const b = [...document.querySelectorAll(".seg button")].pop();
    if (b) b.click();
  });
  await sleep(800);
  await page.screenshot({ path: path.join(OUT, "06-mobile-preview.png") });
  console.log("  ✓ 截图 06-mobile-preview.png");

  // 窄屏（平板/手机）整体布局
  await page.setViewport({ width: 430, height: 880, isMobile: true });
  await sleep(800);
  await page.screenshot({ path: path.join(OUT, "07-responsive.png") });
  console.log("  ✓ 截图 07-responsive.png");

  console.log("\n页面 JS 错误：", errors.length ? errors : "无");
  fs.writeFileSync(path.join(OUT, "errors.json"), JSON.stringify(errors, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
