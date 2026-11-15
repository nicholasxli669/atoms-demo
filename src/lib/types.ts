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
  | { t: "summary"; text: string }
  | { t: "error"; message: string }
  | { t: "end" };
