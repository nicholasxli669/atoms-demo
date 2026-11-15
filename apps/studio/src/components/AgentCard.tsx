"use client";

import { Icon } from "./icons";
import type { ChatMessage, Step } from "@/lib/types";

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
