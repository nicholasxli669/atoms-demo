/**
 * 存储层：一套接口，两种驱动
 *  - 本地/长驻 Node：node:sqlite（零依赖，SQLite 单文件）
 *  - Serverless 部署：libSQL / Turso（TURSO_DATABASE_URL 存在时自动切换）
 * 这样"数据持久化"既能本地零配置跑起来，也能直接上云。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Project, Version, ChatMessage, Plan, Step } from "./types";

type Row = Record<string, unknown>;
type Arg = string | number | null;

interface Driver {
  name: string;
  exec(sql: string): Promise<void>;
  all(sql: string, args?: Arg[]): Promise<Row[]>;
  run(sql: string, args?: Arg[]): Promise<{ lastInsertRowid: number }>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  app_name TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  steps TEXT,
  plan TEXT,
  version_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  label TEXT NOT NULL,
  code TEXT NOT NULL,
  summary TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_project ON messages(project_id);
CREATE INDEX IF NOT EXISTS idx_versions_project ON versions(project_id);
`;

/* ------------------------------- drivers ------------------------------- */

function sqliteFile(): string {
  const dir =
    process.env.DATA_DIR ||
    (process.env.VERCEL ? path.join(os.tmpdir(), "atoms-demo") : path.join(process.cwd(), "data"));
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "atoms.db");
}

async function createSqliteDriver(): Promise<Driver> {
  const mod = (await import("node:sqlite")) as unknown as {
    DatabaseSync: new (file: string) => {
      exec(sql: string): void;
      prepare(sql: string): {
        all(...a: unknown[]): Row[];
        run(...a: unknown[]): { lastInsertRowid: number | bigint; changes: number };
      };
    };
  };
  const file = sqliteFile();
  const db = new mod.DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  return {
    name: "sqlite:" + path.basename(path.dirname(file)),
    async exec(sql) {
      db.exec(sql);
    },
    async all(sql, args = []) {
      return db.prepare(sql).all(...args) as Row[];
    },
    async run(sql, args = []) {
      const r = db.prepare(sql).run(...args);
      return { lastInsertRowid: Number(r.lastInsertRowid) };
    },
  };
}

async function createLibsqlDriver(url: string, authToken?: string): Promise<Driver> {
  const mod = (await import("@libsql/client")) as unknown as {
    createClient: (o: { url: string; authToken?: string }) => {
      execute(q: { sql: string; args: Arg[] }): Promise<{
        rows: Row[];
        lastInsertRowid?: number | bigint | null;
      }>;
      executeMultiple(sql: string): Promise<unknown>;
    };
  };
  const client = mod.createClient({ url, authToken });
  return {
    name: "libsql:" + (url.split("//")[1]?.split(".")[0] ?? "remote"),
    async exec(sql) {
      // libSQL 的 execute 一次只允许一条语句，按 ; 拆分执行
      for (const stmt of sql.split(";")) {
        if (stmt.trim()) await client.execute({ sql: stmt, args: [] });
      }
    },
    async all(sql, args = []) {
      const rs = await client.execute({ sql, args });
      return rs.rows as Row[];
    },
    async run(sql, args = []) {
      const rs = await client.execute({ sql, args });
      return { lastInsertRowid: Number(rs.lastInsertRowid ?? 0) };
    },
  };
}

/* ------------------------------- singleton ------------------------------- */

let driverPromise: Promise<Driver> | null = null;

async function getDriver(): Promise<Driver> {
  if (!driverPromise) {
    driverPromise = (async () => {
      const url = process.env.TURSO_DATABASE_URL ?? process.env.LIBSQL_URL;
      if (!url && process.env.VERCEL) {
        console.warn(
          "[atoms-demo] 未配置 TURSO_DATABASE_URL：Serverless 上的 SQLite 会落在临时目录，重启后数据丢失。部署前请接 Turso / libSQL。",
        );
      }
      const d = url
        ? await createLibsqlDriver(url, process.env.TURSO_AUTH_TOKEN)
        : await createSqliteDriver();
      await d.exec(SCHEMA);
      return d;
    })();
  }
  return driverPromise;
}

export async function storeInfo() {
  const d = await getDriver();
  const remote = d.name.startsWith("libsql:");
  return {
    driver: d.name,
    persistent: remote || !process.env.VERCEL,
  };
}

/* ------------------------------- mappers ------------------------------- */

const n = (v: unknown) => Number(v ?? 0);
const s = (v: unknown) => (v == null ? null : String(v));

function toProject(r: Row): Project {
  return {
    id: String(r.id),
    name: String(r.name),
    appName: s(r.app_name),
    createdAt: n(r.created_at),
    updatedAt: n(r.updated_at),
    versionCount: r.version_count == null ? undefined : n(r.version_count),
  };
}

function toVersion(r: Row): Version {
  return {
    id: n(r.id),
    projectId: String(r.project_id),
    label: String(r.label),
    code: String(r.code),
    summary: s(r.summary),
    createdAt: n(r.created_at),
  };
}

function toMessage(r: Row): ChatMessage {
  let steps: Step[] | null = null;
  let plan: Plan | null = null;
  try {
    if (r.steps) steps = JSON.parse(String(r.steps)) as Step[];
  } catch {
    steps = null;
  }
  try {
    if (r.plan) plan = JSON.parse(String(r.plan)) as Plan;
  } catch {
    plan = null;
  }
  return {
    id: n(r.id),
    projectId: String(r.project_id),
    role: String(r.role) === "agent" ? "agent" : "user",
    content: String(r.content ?? ""),
    steps,
    plan,
    versionId: r.version_id == null ? null : n(r.version_id),
    createdAt: n(r.created_at),
  };
}

/* ------------------------------- API ------------------------------- */

export const store = {
  async listProjects(): Promise<Project[]> {
    const d = await getDriver();
    const rows = await d.all(
      `SELECT p.*, (SELECT COUNT(*) FROM versions v WHERE v.project_id = p.id) AS version_count
       FROM projects p ORDER BY p.updated_at DESC LIMIT 100`,
    );
    return rows.map(toProject);
  },

  async createProject(name: string): Promise<Project> {
    const d = await getDriver();
    const now = Date.now();
    const p: Project = {
      id: randomUUID(),
      name: name.slice(0, 60) || "未命名应用",
      appName: null,
      createdAt: now,
      updatedAt: now,
      versionCount: 0,
    };
    await d.run(
      `INSERT INTO projects (id, name, app_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [p.id, p.name, null, now, now],
    );
    return p;
  },

  async getProject(id: string): Promise<Project | null> {
    const d = await getDriver();
    const rows = await d.all(
      `SELECT p.*, (SELECT COUNT(*) FROM versions v WHERE v.project_id = p.id) AS version_count
       FROM projects p WHERE p.id = ?`,
      [id],
    );
    return rows[0] ? toProject(rows[0]) : null;
  },

  async updateProject(id: string, patch: { name?: string; appName?: string | null }) {
    const d = await getDriver();
    if (patch.name !== undefined) {
      await d.run(`UPDATE projects SET name = ?, updated_at = ? WHERE id = ?`, [
        patch.name.slice(0, 60),
        Date.now(),
        id,
      ]);
    }
    if (patch.appName !== undefined) {
      await d.run(`UPDATE projects SET app_name = ?, updated_at = ? WHERE id = ?`, [
        patch.appName,
        Date.now(),
        id,
      ]);
    }
  },

  async touchProject(id: string) {
    const d = await getDriver();
    await d.run(`UPDATE projects SET updated_at = ? WHERE id = ?`, [Date.now(), id]);
  },

  async deleteProject(id: string) {
    const d = await getDriver();
    // 没有外键约束，三张表必须一起删；放进事务避免中途失败留下孤儿行
    await d.exec("BEGIN");
    try {
      await d.run(`DELETE FROM messages WHERE project_id = ?`, [id]);
      await d.run(`DELETE FROM versions WHERE project_id = ?`, [id]);
      await d.run(`DELETE FROM projects WHERE id = ?`, [id]);
      await d.exec("COMMIT");
    } catch (e) {
      await d.exec("ROLLBACK");
      throw e;
    }
  },

  async listMessages(projectId: string): Promise<ChatMessage[]> {
    const d = await getDriver();
    const rows = await d.all(
      `SELECT * FROM messages WHERE project_id = ? ORDER BY id ASC LIMIT 500`,
      [projectId],
    );
    return rows.map(toMessage);
  },

  async addMessage(m: {
    projectId: string;
    role: "user" | "agent";
    content: string;
    steps?: Step[] | null;
    plan?: Plan | null;
    versionId?: number | null;
  }): Promise<ChatMessage> {
    const d = await getDriver();
    const now = Date.now();
    const { lastInsertRowid } = await d.run(
      `INSERT INTO messages (project_id, role, content, steps, plan, version_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        m.projectId,
        m.role,
        m.content,
        m.steps ? JSON.stringify(m.steps) : null,
        m.plan ? JSON.stringify(m.plan) : null,
        m.versionId ?? null,
        now,
      ],
    );
    return {
      id: lastInsertRowid,
      projectId: m.projectId,
      role: m.role,
      content: m.content,
      steps: m.steps ?? null,
      plan: m.plan ?? null,
      versionId: m.versionId ?? null,
      createdAt: now,
    };
  },

  async listVersions(projectId: string, withCode = true): Promise<Version[]> {
    const d = await getDriver();
    const rows = await d.all(
      `SELECT ${withCode ? "*" : "id, project_id, label, summary, created_at, '' AS code"}
       FROM versions WHERE project_id = ? ORDER BY id ASC LIMIT 200`,
      [projectId],
    );
    return rows.map(toVersion);
  },

  async getVersion(id: number): Promise<Version | null> {
    const d = await getDriver();
    const rows = await d.all(`SELECT * FROM versions WHERE id = ?`, [id]);
    return rows[0] ? toVersion(rows[0]) : null;
  },

  /**
   * 存版本。label 省略时在 SQL 里原子分配（v1、v2、…）：
   * 并发写同一个项目时，SQLite 串行化写事务，后到的语句能看见前一条已插入的行，
   * 因此不会出现"两次生成都算出 v3"的撞号。调用方不要自己数版本号再传 label。
   */
  async addVersion(v: {
    projectId: string;
    label?: string;
    code: string;
    summary?: string | null;
  }): Promise<Version> {
    const d = await getDriver();
    const now = Date.now();
    const { lastInsertRowid } = await d.run(
      `INSERT INTO versions (project_id, label, code, summary, created_at)
       VALUES (?, COALESCE(?, (SELECT 'v' || (COUNT(*) + 1) FROM versions WHERE project_id = ?)), ?, ?, ?)`,
      [v.projectId, v.label ?? null, v.projectId, v.code, v.summary ?? null, now],
    );
    await this.touchProject(v.projectId);
    const rows = await d.all(`SELECT label FROM versions WHERE id = ?`, [lastInsertRowid]);
    const label = (rows[0] as { label?: string } | undefined)?.label ?? v.label ?? "";
    return {
      id: lastInsertRowid,
      projectId: v.projectId,
      label,
      code: v.code,
      summary: v.summary ?? null,
      createdAt: now,
    };
  },
};
