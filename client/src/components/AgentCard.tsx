"use client";

import { Icon } from "./icons";
import { verdict } from "@/lib/report";
import type { ChatMessage, Report, Step } from "@/lib/types";

export interface LiveRun {
  steps: Step[];
  running: boolean;
  chars: number;
}

const StepIcon = ({ status }: { status: Step["status"] }) => {
  if (status === "run") return <Icon.loader size={9} className="spin" />;
  if (status === "ok") return <Icon.check size={9} />;
  if (status === "err") return <Icon.x size={9} />;
  return <span style={{ fontSize: 8 }}>–</span>;
};

function StepList({ steps }: { steps: Step[] }) {
  if (!steps.length) return null;
  return (
    <div className="steps">
      {steps.map((s) => (
        <div key={s.key} className={`step ${s.status}`}>
          <span className="step-icon">
            <StepIcon status={s.status} />
          </span>
          <span className="step-body">
            <span className="step-label">{s.label}</span>
            {s.detail && <div className="step-detail">{s.detail}</div>}
          </span>
        </div>
      ))}
    </div>
  );
}

/** 质量验收报告：把"检查了什么 / 修了几轮 / 多大 / 多久"摊开给人看 */
function ReportCard({ report }: { report: Report }) {
  const bad = report.checks.filter((c) => !c.ok).length;
  return (
    <div className={`report ${report.ok ? "pass" : "fail"}`}>
      <div className="report-head">
        <span className="report-title">
          <Icon.shield size={11} /> 质量验收
        </span>
        <span className={`report-badge ${report.ok ? "ok" : "bad"}`}>
          {report.ok ? "静态体检通过" : `${bad} 项不合格`}
        </span>
      </div>

      <div className="report-verdict">{verdict(report)}</div>

      <div className="checks">
        {report.checks.map((c) => (
          <span key={c.key} className={`check ${c.ok ? "ok" : "bad"}`} title={c.detail ?? c.label}>
            <span className="check-icon">
              {c.ok ? <Icon.check size={8} /> : <Icon.x size={8} />}
            </span>
            {c.label}
            {c.detail && c.label !== c.detail && !c.ok && <b> · {c.detail}</b>}
          </span>
        ))}
      </div>

      <div className="report-meta">
        <span>{report.mode === "new" ? "新建" : "改版"}</span>
        <span>{report.lines} 行</span>
        <span>{(report.bytes / 1024).toFixed(1)} KB</span>
        <span>{(report.ms / 1000).toFixed(1)}s</span>
        <span>
          修复 {report.repairs} 轮 · 续写 {report.continuations} 次
        </span>
        {report.warns > 0 && <span className="warn">{report.warns} 条建议</span>}
      </div>
    </div>
  );
}

export default function AgentCard({
  msg,
  live,
  onTab,
  onExport,
}: {
  msg?: ChatMessage;
  live?: LiveRun;
  onTab?: (t: "code" | "preview") => void;
  onExport?: () => void;
}) {
  const steps = live?.steps ?? msg?.steps ?? [];
  const plan = msg?.plan;
  const running = live?.running ?? false;
  const report = msg?.report ?? null;

  return (
    <div className="agent-card">
      <div className="agent-head">
        <span className="agent-avatar">
          <Icon.spark size={11} />
        </span>
        <b>Atoms Agent</b>
        {running && (
          <span className="meta">
            <Icon.loader size={11} className="spin" /> 执行中
          </span>
        )}
      </div>

      <StepList steps={steps} />

      {running && (
        <div className="stream-meter">
          <Icon.code size={12} />
          <span>{live?.chars ? `已生成 ${live.chars} 字符` : "思考中"}</span>
          <span className="bar">
            <span />
          </span>
        </div>
      )}

      {plan && plan.features.length > 0 && (
        <div className="plan-chips">
          {plan.features.map((f) => (
            <span key={f} className="plan-chip">
              {f}
            </span>
          ))}
        </div>
      )}

      {report && <ReportCard report={report} />}

      {msg?.content && <div className="agent-summary">{msg.content}</div>}

      {!running && msg && (
        <div className="agent-actions">
          <button className="btn sm" onClick={() => onTab?.("preview")}>
            <Icon.eye size={12} /> 预览
          </button>
          <button className="btn sm" onClick={() => onTab?.("code")}>
            <Icon.code size={12} /> 源码
          </button>
          <button className="btn sm" onClick={onExport}>
            <Icon.download size={12} /> 导出 HTML
          </button>
        </div>
      )}
    </div>
  );
}
