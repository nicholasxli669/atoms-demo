"use client";

import { useMemo } from "react";
import { Icon } from "./icons";
import { instrument } from "@/lib/instrument";
import type { ConsoleEntry, Version } from "@/lib/types";

type Tab = "preview" | "code" | "console";
type Device = "desktop" | "tablet" | "mobile";

export default function PreviewPanel({
  code,
  versions,
  activeVersionId,
  onSelectVersion,
  tab,
  setTab,
  device,
  setDevice,
  entries,
  onFix,
  onExport,
  onOpen,
  reloadTick,
  onReload,
  running,
  chars,
}: {
  code: string;
  versions: Version[];
  activeVersionId: number | null;
  onSelectVersion: (id: number) => void;
  tab: Tab;
  setTab: (t: Tab) => void;
  device: Device;
  setDevice: (d: Device) => void;
  entries: ConsoleEntry[];
  onFix: () => void;
  onExport: () => void;
  onOpen: () => void;
  reloadTick: number;
  onReload: () => void;
  running: boolean;
  chars: number;
}) {
  const srcDoc = useMemo(() => (code ? instrument(code) : ""), [code]);
  const errors = entries.filter((e) => e.level === "error");
  const lines = code ? code.split("\n") : [];

  return (
    <section className="preview" aria-label="预览">
      <div className="preview-head">
        <div className="tabs" role="tablist" aria-label="视图切换">
          <button
            role="tab"
            aria-selected={tab === "preview"}
            className={`tab${tab === "preview" ? " active" : ""}`}
            onClick={() => setTab("preview")}
          >
            <Icon.eye size={13} /> 预览
          </button>
          <button
            role="tab"
            aria-selected={tab === "code"}
            className={`tab${tab === "code" ? " active" : ""}`}
            onClick={() => setTab("code")}
          >
            <Icon.code size={13} /> 代码
          </button>
          <button
            role="tab"
            aria-selected={tab === "console"}
            className={`tab${tab === "console" ? " active" : ""}`}
            onClick={() => setTab("console")}
          >
            <Icon.terminal size={13} /> 控制台
            {errors.length > 0 && <span className="badge">{errors.length}</span>}
          </button>
        </div>

        <div className="preview-tools">
          <div className="seg" role="group" aria-label="设备尺寸">
            <button
              className={device === "desktop" ? "active" : ""}
              onClick={() => setDevice("desktop")}
              aria-label="桌面"
              title="桌面"
            >
              <Icon.desktop size={13} />
            </button>
            <button
              className={device === "tablet" ? "active" : ""}
              onClick={() => setDevice("tablet")}
              aria-label="平板"
              title="平板"
            >
              <Icon.tablet size={13} />
            </button>
            <button
              className={device === "mobile" ? "active" : ""}
              onClick={() => setDevice("mobile")}
              aria-label="手机"
              title="手机"
            >
              <Icon.mobile size={13} />
            </button>
          </div>
          <button className="btn ghost icon hide-sm" onClick={onReload} aria-label="重新加载预览" title="重新加载">
            <Icon.refresh size={14} />
          </button>
          <button className="btn ghost icon hide-sm" onClick={onOpen} aria-label="新标签打开" title="新标签打开">
            <Icon.external size={14} />
          </button>
          <button className="btn sm" onClick={onExport} disabled={!code}>
            <Icon.download size={12} /> 导出
          </button>
        </div>
      </div>

      <div className="preview-body">
        {versions.length > 0 && (
          <div className="versions" aria-label="版本历史">
            <span className="versions-label">版本</span>
            {versions.map((v) => (
              <button
                key={v.id}
                className={`vchip${v.id === activeVersionId ? " active" : ""}`}
                onClick={() => onSelectVersion(v.id)}
                title={v.summary || v.label}
              >
                {v.label}
              </button>
            ))}
          </div>
        )}

        {tab === "preview" &&
          (code ? (
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              <div className={`stage device-${device}`}>
                <iframe
                  key={`${activeVersionId}-${reloadTick}`}
                  title="生成应用预览"
                  srcDoc={srcDoc}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
                />
                {running && (
                  <div className="stage-loading">
                    <div>
                      <div className="ring" />
                      <div>
                        Agent 正在生成<span className="bar" style={{ display: "inline-block", width: 60 }} />
                      </div>
                      <div style={{ marginTop: 6 }}>
                        已输出 <code>{chars}</code> 个字符
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : running ? (
            <div className="placeholder">
              <div className="inner">
                <div className="glyph">
                  <Icon.loader size={20} className="spin" />
                </div>
                Agent 正在规划并生成第一个版本…
              </div>
            </div>
          ) : (
            <div className="placeholder">
              <div className="inner">
                <div className="glyph">
                  <Icon.eye size={20} />
                </div>
                在左侧描述你想要的网页应用，Agent 生成完成后<strong style={{ color: "var(--txt-2)" }}> 实时渲染</strong>
                在这里。
                <br />
                生成的应用可以点击、可以填写、刷新后数据还在。
              </div>
            </div>
          ))}

        {tab === "code" && (
          <div className="codeview">
            {code ? (
              <pre>
                {lines.map((l, i) => (
                  <div className="ln" key={i}>
                    <span>{l || " "}</span>
                  </div>
                ))}
              </pre>
            ) : (
              <div className="code-empty">还没有生成代码</div>
            )}
          </div>
        )}

        {tab === "console" && (
          <>
            <div className="console-bar">
              <span className="composer-hint">
                捕获生成应用的 console 与运行时报错（刷新预览时清空）
              </span>
              <span className="spacer" />
              <button className="btn sm" onClick={onReload}>
                <Icon.refresh size={12} /> 刷新预览
              </button>
              <button className="btn primary sm" onClick={onFix} disabled={!errors.length || running}>
                <Icon.bug size={12} /> 让 Agent 修复 {errors.length ? `(${errors.length})` : ""}
              </button>
            </div>
            <div className="consolev">
              {entries.length === 0 ? (
                <div className="console-empty">
                  控制台是干净的。
                  <br />
                  点击「刷新预览」可重新捕获输出。
                </div>
              ) : (
                entries.map((e) => (
                  <div key={e.id} className={`console-row ${e.level}`}>
                    <span className="ts">{e.at}</span>
                    <span>{e.text}</span>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
