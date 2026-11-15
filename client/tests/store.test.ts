import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// store 的 DATA_DIR 是在第一次取 driver 时才读的，这里先指到临时目录，避免动到 ./data
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "atoms-store-test-"));
process.env.DATA_DIR = tmp;

const { store } = await import("../src/lib/store.ts");

test("同一项目并发写版本不撞号", async () => {
  const p = await store.createProject("并发测试");
  const saved = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      store.addVersion({ projectId: p.id, code: `<html>第 ${i} 版</html>` }),
    ),
  );
  const labels = saved.map((v) => v.label).sort();
  assert.deepEqual(labels, ["v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8"]);
  assert.equal(new Set(saved.map((v) => v.id)).size, 8);
});

test("版本号按项目独立计数", async () => {
  const a = await store.createProject("项目 A");
  const b = await store.createProject("项目 B");
  await store.addVersion({ projectId: a.id, code: "<html>a1</html>" });
  const a2 = await store.addVersion({ projectId: a.id, code: "<html>a2</html>" });
  const b1 = await store.addVersion({ projectId: b.id, code: "<html>b1</html>" });
  assert.equal(a2.label, "v2");
  assert.equal(b1.label, "v1");
});

test("显式传 label 时按传入值写入", async () => {
  const p = await store.createProject("显式 label");
  const v = await store.addVersion({ projectId: p.id, label: "custom-1", code: "<html>x</html>" });
  assert.equal(v.label, "custom-1");
});
