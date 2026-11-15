"use client";

import { Icon } from "./icons";
import type { Project } from "@/lib/types";

function ago(ts: number): string {
  const d = Math.max(0, Date.now() - ts);
  const m = Math.floor(d / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const day = Math.floor(h / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(ts).toLocaleDateString("zh-CN");
}

export default function Sidebar({
  projects,
  activeId,
  onOpen,
  onNew,
  onDelete,
  health,
  open,
}: {
  projects: Project[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  health: { mode: string; model: string; store: string } | null;
  open: boolean;
}) {
  return (
    <aside className={`sidebar${open ? " open" : ""}`} aria-label="项目列表">
      <div className="sidebar-head">
        <button className="btn primary" onClick={onNew} style={{ width: "100%" }}>
          <Icon.plus size={15} /> 新建应用
        </button>
        <div className="sidebar-label">
          <span>我的应用</span>
          <span>{projects.length}</span>
        </div>
      </div>

      <div className="project-list">
        {projects.length === 0 && (
          <p style={{ fontSize: 11.5, color: "var(--txt-3)", padding: "8px 10px", lineHeight: 1.7 }}>
            还没有应用。描述一个想法，Agent 会生成第一个可运行版本。
          </p>
        )}
        {projects.map((p) => (
          <div
            key={p.id}
            className={`project-item${p.id === activeId ? " active" : ""}`}
            onClick={() => onOpen(p.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen(p.id);
              }
            }}
          >
            <span className="pj-icon">
              <Icon.layers size={12} />
            </span>
            <span className="pj-body">
              <span className="pj-name">{p.appName || p.name}</span>
              <span className="pj-meta">
                <Icon.clock size={10} /> {ago(p.updatedAt)}
                {p.versionCount ? <span>· v{p.versionCount}</span> : null}
              </span>
            </span>
            <button
              className="pj-del"
              aria-label={`删除 ${p.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(p.id);
              }}
            >
              <Icon.trash size={12} />
            </button>
          </div>
        ))}
      </div>

      <div className="sidebar-foot">
        <div className="row">
          <span>模型</span>
          <code>{health?.model ?? "检测中…"}</code>
        </div>
        <div className="row">
          <span>存储</span>
          <code>{health?.store ?? "…"}</code>
        </div>
        <div className="row">
          <span>状态</span>
          <span style={{ color: health?.mode === "demo" ? "var(--warn)" : "var(--ok)" }}>
            {health?.mode === "demo" ? "离线演示" : health?.mode === "live" ? "已连接" : "…"}
          </span>
        </div>
      </div>
    </aside>
  );
}
