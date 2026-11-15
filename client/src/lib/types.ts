/** 共享类型定义（前后端通用） */

export type Role = "user" | "agent";

export type StepStatus = "run" | "ok" | "err" | "skip";

export interface Step {
  key: string;
  label: string;
  status: StepStatus;
  detail?: string;
}

export interface Plan {
  name: string;
  summary: string;
  features: string[];
}

export interface Project {
  id: string;
  name: string;
  appName: string | null;
  createdAt: number;
  updatedAt: number;
  versionCount?: number;
}

export interface Version {
  id: number;
  projectId: string;
  label: string;
  code: string;
  summary: string | null;
  createdAt: number;
}

export interface ChatMessage {
  id: number;
  projectId: string;
  role: Role;
  content: string;
  steps: Step[] | null;
  plan: Plan | null;
  versionId: number | null;
  createdAt: number;
  /** 质量验收报告：静态体检逐项结果 + 修复/续写次数（历史消息也能看） */
  report?: Report | null;
}

export interface CheckResult {
  key: string;
  label: string;
  ok: boolean;
  detail?: string;
}

export interface Report {
  /** 是否通过静态体检（无 error） */
  ok: boolean;
  checks: CheckResult[];
  /** 自动修复轮数（含按运行时报错修复） */
  repairs: number;
  /** 被 8k 输出上限截断后的续写次数 */
  continuations: number;
  lines: number;
  bytes: number;
  /** 本轮总耗时（毫秒） */
  ms: number;
  /** 建议条数（warn） */
  warns: number;
  mode: "new" | "edit";
  at: number;
}

export interface ConsoleEntry {
  id: number;
  level: "log" | "warn" | "error";
  text: string;
  at: string;
}

/** SSE 事件协议：服务端 -> 客户端 */
export type AgentEvent =
  | { t: "start"; runId: string }
  | { t: "step"; key: string; label: string; status: StepStatus; detail?: string }
  | { t: "plan"; plan: Plan }
  | { t: "delta"; chars: number }
  | { t: "validate"; ok: boolean; issues: { level: string; msg: string }[] }
  | { t: "version"; version: Version }
  | { t: "report"; report: Report }
  | { t: "summary"; text: string }
  | { t: "error"; message: string }
  | { t: "end" };
