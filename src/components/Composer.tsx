"use client";

import { useEffect, useRef } from "react";
import { Icon } from "./icons";

export default function Composer({
  value,
  onChange,
  onSend,
  onStop,
  running,
  hasVersion,
  demo,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  running: boolean;
  hasVersion: boolean;
  demo: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [value]);

  const disabled = !value.trim() || running;

  return (
    <div className="composer-wrap">
      <div className="composer">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (!disabled) onSend();
            }
          }}
          placeholder={
            hasVersion
              ? "继续描述改动，例如：加一个按分类筛选的下拉框，并把金额改成两位数小数"
              : "用一句话描述你想要的应用，例如：一个团队任务看板，支持优先级、搜索和完成状态"
          }
          aria-label="需求输入"
          rows={1}
        />
        <div className="composer-bar">
          <span className="composer-hint">
            {hasVersion ? (
              <>
                <Icon.wand size={11} /> 修改模式
              </>
            ) : (
              <>
                <Icon.spark size={11} /> 生成模式
              </>
            )}
            {demo && <span style={{ color: "var(--warn)" }}>· 离线演示</span>}
          </span>
          <span className="spacer" />
          <span className="composer-hint hide-sm">
            <kbd>Enter</kbd> 发送 · <kbd>Shift</kbd>+<kbd>Enter</kbd> 换行
          </span>
          {running ? (
            <button className="btn sm" onClick={onStop} title="停止生成">
              <Icon.stop size={12} /> 停止
            </button>
          ) : (
            <button className="btn primary sm" onClick={onSend} disabled={disabled}>
              {hasVersion ? "修改" : "生成"} <Icon.arrow size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
