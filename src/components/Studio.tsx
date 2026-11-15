"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Sidebar from "./Sidebar";
import AgentCard from "./AgentCard";
import Composer from "./Composer";
import PreviewPanel from "./PreviewPanel";
import { Icon } from "./icons";
import type {
  AgentEvent,
  ChatMessage,
  ConsoleEntry,
  Plan,
  Project,
  Step,
  Version,
} from "@/lib/types";

type Tab = "preview" | "code" | "console";
type Device = "desktop" | "tablet" | "mobile";

const TEMPLATES: { title: string; desc: string; prompt: string }[] = [
  {
    title: "团队任务看板",
    desc: "三列看板 + 优先级 + 筛选",
    prompt:
      "做一个团队任务看板：三列（待办/进行中/已完成），支持新建任务、设置高/中/低优先级、勾选完成、按优先级筛选、统计每列数量，数据保存在本地刷新不丢。",
  },
  {
    title: "极简记账本",
    desc: "收支记录 + 汇总 + 分类筛选",
    prompt:
      "做一个极简记账本：记录每笔收支（说明、金额、分类、收入/支出），顶部汇总总收入/总支出/结余，支持按类型筛选和删除记录，数据本地持久化。",
  },
  {
    title: "习惯打卡",
    desc: "每日打卡 + 连续天数热力图",
    prompt:
      "做一个习惯打卡工具：可以添加多个习惯，每天点击打卡，显示当前连续打卡天数和本月完成率，用方格热力图展示最近 30 天打卡情况，数据本地保存。",
  },
  {
    title: "客户跟进 CRM",
    desc: "客户列表 + 阶段流转 + 备注",
    prompt:
      "做一个轻量销售 CRM：客户列表显示姓名、公司、阶段（线索/沟通中/已成交）、最近联系日期，支持新增客户、切换阶段、按阶段筛选、为每个客户添加跟进备注，数据本地保存。",
  },
];

export default function Studio() {
  const [health, setHealth] = useState<{ mode: string; model: string; store: string } | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<number | null>(null);
  const [code, setCode] = useState("");

  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);
  const [chars, setChars] = useState(0);

  const [tab, setTab] = useState<Tab>("preview");
  const [device, setDevice] = useState<Device>("desktop");
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [reloadTick, setReloadTick] = useState(0);

  const [input, setInput] = useState("");
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"chat" | "preview">("chat");
  const [sideOpen, setSideOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const runSteps = useRef<Step[]>([]);
  const runPlan = useRef<Plan | null>(null);
  const runVersion = useRef<number | null>(null);
  const runSummary = useRef<string | null>(null);
  const runError = useRef<string | null>(null);
  const entrySeq = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeProject = projects.find((p) => p.id === activeId) ?? null;

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    window.setTimeout(() => setToastMsg((cur) => (cur === m ? null : cur)), 2600);
  }, []);

  const pushConsole = useCallback((level: ConsoleEntry["level"], text: string) => {
    entrySeq.current += 1;
    const e: ConsoleEntry = {
      id: entrySeq.current,
      level,
      text,
      at: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
    };
    setEntries((prev) => [...prev.slice(-149), e]);
  }, []);

  /* ---------------------------- 初始化 ---------------------------- */

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setHealth(d))
      .catch(() => setHealth({ mode: "demo", model: "未知", store: "未知" }));
  }, []);

  const refreshProjects = useCallback(async () => {
    try {
      const r = await fetch("/api/projects", { cache: "no-store" });
      const d = (await r.json()) as { projects: Project[] };
      setProjects(d.projects ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  /* ------------------------ 沙箱消息监听 ------------------------ */

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { __atoms?: number; level?: string; text?: string } | null;
      if (!d || typeof d !== "object" || d.__atoms !== 1) return;
      if (d.level === "ready") return;
      const level: ConsoleEntry["level"] =
        d.level === "error" ? "error" : d.level === "warn" ? "warn" : "log";
      pushConsole(level, d.text ?? "");
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [pushConsole]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, running, chars]);

  /* ---------------------------- 项目操作 ---------------------------- */

  const openProject = useCallback(
    async (id: string) => {
      setSideOpen(false);
      try {
        const r = await fetch(`/api/projects/${id}`, { cache: "no-store" });
        if (!r.ok) throw new Error("加载失败");
        const d = (await r.json()) as {
          project: Project;
          messages: ChatMessage[];
          versions: Version[];
        };
        setActiveId(id);
        setMessages(d.messages);
        setVersions(d.versions);
        const last = d.versions[d.versions.length - 1] ?? null;
        setActiveVersionId(last ? last.id : null);
        setCode(last ? last.code : "");
        setEntries([]);
        setSteps([]);
        setTab("preview");
        setMobileView("chat");
      } catch {
        toast("打开项目失败");
      }
    },
    [toast],
  );

  const newProject = useCallback(async () => {
    if (running) return;
    setSideOpen(false);
    setActiveId(null);
    setMessages([]);
    setVersions([]);
    setActiveVersionId(null);
    setCode("");
    setEntries([]);
    setSteps([]);
    setTab("preview");
    setInput("");
    setMobileView("chat");
    await refreshProjects();
  }, [running, refreshProjects]);

  const deleteProject = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/projects/${id}`, { method: "DELETE" });
        if (id === activeId) {
          setActiveId(null);
          setMessages([]);
          setVersions([]);
          setActiveVersionId(null);
          setCode("");
        }
        await refreshProjects();
        toast("已删除");
      } catch {
        toast("删除失败");
      }
    },
    [activeId, refreshProjects, toast],
  );

  /* ---------------------------- 生成流程 ---------------------------- */

  const ensureProject = useCallback(async (): Promise<string> => {
    if (activeId) return activeId;
    const r = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const d = (await r.json()) as { project: Project };
    setProjects((prev) => [d.project, ...prev]);
    setActiveId(d.project.id);
    return d.project.id;
  }, [activeId]);

  const handleEvent = useCallback(
    (ev: AgentEvent, projectId: string) => {
      switch (ev.t) {
        case "step": {
          const next = [...runSteps.current];
          const i = next.findIndex((s) => s.key === ev.key);
          const item: Step = { key: ev.key, label: ev.label, status: ev.status, detail: ev.detail };
          if (i >= 0) next[i] = item;
          else next.push(item);
          runSteps.current = next;
          setSteps(next);
          break;
        }
        case "plan":
          runPlan.current = ev.plan;
          break;
        case "delta":
          setChars(ev.chars);
          break;
        case "validate":
          ev.issues.forEach((i) => pushConsole(i.level === "error" ? "error" : "warn", `[静态校验] ${i.msg}`));
          break;
        case "version":
          runVersion.current = ev.version.id;
          setVersions((prev) => (prev.some((v) => v.id === ev.version.id) ? prev : [...prev, ev.version]));
          setActiveVersionId(ev.version.id);
          setCode(ev.version.code);
          setEntries([]);
          setChars(0);
          setTab("preview");
          break;
        case "summary":
          runSummary.current = ev.text;
          break;
        case "error":
          runError.current = ev.message;
          break;
        case "end": {
          const content =
            runSummary.current ??
            (runError.current ? `生成中断：${runError.current}` : "本轮没有产出内容，可以补充描述后重试。");
          const msg: ChatMessage = {
            id: Date.now(),
            projectId,
            role: "agent",
            content,
            steps: runSteps.current,
            plan: runPlan.current,
            versionId: runVersion.current,
            createdAt: Date.now(),
          };
          setMessages((prev) => [...prev, msg]);
          if (runError.current) toast(runError.current.slice(0, 90));
          break;
        }
        case "start":
          break;
      }
    },
    [pushConsole, toast],
  );

  const send = useCallback(
    async (raw: string, opts?: { runtimeLogs?: string[] }) => {
      const text = raw.trim();
      if (!text || running) return;
      let pid: string;
      try {
        pid = await ensureProject();
      } catch {
        toast("创建项目失败，请重试");
        return;
      }

      runSteps.current = [];
      runPlan.current = null;
      runVersion.current = null;
      runSummary.current = null;
      runError.current = null;

      setInput("");
      setSteps([]);
      setChars(0);
      setRunning(true);
      setMobileView("chat");
      setMessages((prev) => [
        ...prev,
        {
          id: -Date.now(),
          projectId: pid,
          role: "user",
          content: text,
          steps: null,
          plan: null,
          versionId: null,
          createdAt: Date.now(),
        },
      ]);

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({
            projectId: pid,
            message: text,
            mode: versions.length > 0 ? "edit" : "new",
            baseCode: code,
            runtimeLogs: opts?.runtimeLogs,
          }),
        });
        if (!res.ok || !res.body) throw new Error((await res.text()).slice(0, 200));

        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const frame = buf.slice(0, i).trim();
            buf = buf.slice(i + 2);
            if (!frame.startsWith("data:")) continue;
            try {
              handleEvent(JSON.parse(frame.slice(5).trim()) as AgentEvent, pid);
            } catch {
              /* 忽略坏帧 */
            }
          }
        }
      } catch (err) {
        const e = err as Error;
        if (e.name !== "AbortError") {
          toast("生成失败：" + e.message.slice(0, 100));
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: Date.now(),
              projectId: pid,
              role: "agent",
              content: "已停止本轮生成。",
              steps: runSteps.current,
              plan: runPlan.current,
              versionId: runVersion.current,
              createdAt: Date.now(),
            },
          ]);
        }
      } finally {
        abortRef.current = null;
        setRunning(false);
        void refreshProjects();
      }
    },
    [running, ensureProject, versions.length, code, handleEvent, toast, refreshProjects],
  );

  /* ---------------------------- 辅助动作 ---------------------------- */

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const selectVersion = useCallback(
    (id: number) => {
      const v = versions.find((x) => x.id === id);
      if (!v) return;
      setActiveVersionId(id);
      setCode(v.code);
      setEntries([]);
      setReloadTick((t) => t + 1);
      setTab("preview");
    },
    [versions],
  );

  const reloadPreview = useCallback(() => {
    setEntries([]);
    setReloadTick((t) => t + 1);
  }, []);

  const exportHtml = useCallback(() => {
    if (!code) return;
    const blob = new Blob([code], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(activeProject?.appName || "atoms-app").replace(/[\\/:*?"<>|]/g, "")}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast("已导出 HTML 文件");
  }, [code, activeProject, toast]);

  const openExternal = useCallback(() => {
    if (!code) return;
    const blob = new Blob([code], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
  }, [code]);

  const fixFromConsole = useCallback(() => {
    const errs = entries.filter((e) => e.level === "error").map((e) => e.text);
    if (!errs.length || running) return;
    void send(
      `页面运行时出现以下报错，请定位原因并修复（保持现有功能不变）：\n${errs.slice(0, 6).join("\n")}`,
      { runtimeLogs: errs.slice(0, 6) },
    );
  }, [entries, running, send]);

  /* ---------------------------- 渲染 ---------------------------- */

  return (
    <div className="app">
      <header className="topbar">
        <button
          className="btn ghost icon sidebar-toggle"
          onClick={() => setSideOpen((v) => !v)}
          aria-label="打开项目列表"
        >
          <Icon.menu size={16} />
        </button>
        <div className="brand">
          <span className="brand-mark">
            <Icon.spark size={13} />
          </span>
          <span className="brand-name">Atoms Demo</span>
          <span className="brand-sub">Agent Studio</span>
        </div>

        <div className="topbar-project">
          {activeProject ? (
            <>
              <span>/</span>
              <b>{activeProject.appName || activeProject.name}</b>
              {versions.length > 0 && <span className="chip">{versions.length} 个版本</span>}
            </>
          ) : (
            <span style={{ color: "var(--txt-3)" }}>未选择项目</span>
          )}
        </div>

        <div className="topbar-right">
          <span className={`chip${health?.mode === "demo" ? " demo" : ""}`}>
            <span className="dot" />
            {health?.mode === "demo" ? "离线演示模式" : "Agent 在线"}
            {health?.model ? <code>· {health.model}</code> : null}
          </span>
          <a
            className="btn ghost sm hide-sm"
            href="https://atoms.dev/"
            target="_blank"
            rel="noreferrer"
            style={{ textDecoration: "none" }}
          >
            参考产品
          </a>
        </div>
      </header>

      <div className={`work${mobileView === "preview" ? " show-preview" : ""}`}>
        <Sidebar
          projects={projects}
          activeId={activeId}
          onOpen={openProject}
          onNew={newProject}
          onDelete={deleteProject}
          health={health}
          open={sideOpen}
        />

        <section className="chat" aria-label="对话">
          <div className="chat-scroll" ref={scrollRef}>
            {messages.length === 0 && !running && (
              <div className="empty">
                <div className="empty-kicker">
                  <Icon.spark size={13} /> Agent Studio
                </div>
                <h1>
                  用一句话描述，
                  <br />
                  得到一个<em>能点、能存、能导出</em>的网页应用
                </h1>
                <p>
                  Agent 会先拆解需求，再流式生成单文件应用，自动做静态校验（失败会自我修复），
                  最后把可运行的页面渲染在右侧。生成后可以继续对话修改，每个版本都能回滚。
                </p>
                <div className="tpl-grid">
                  {TEMPLATES.map((t) => (
                    <button key={t.title} className="tpl" onClick={() => void send(t.prompt)}>
                      <span className="tpl-title">
                        <Icon.wand size={13} /> {t.title}
                      </span>
                      <span className="tpl-desc">{t.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m) =>
              m.role === "user" ? (
                <div className="msg user" key={m.id}>
                  <div className="user-bubble">{m.content}</div>
                </div>
              ) : (
                <div className="msg" key={m.id}>
                  <AgentCard
                    msg={m}
                    onTab={(t) => {
                      setTab(t);
                      setMobileView("preview");
                    }}
                    onExport={exportHtml}
                  />
                </div>
              ),
            )}

            {running && (
              <div className="msg">
                <AgentCard live={{ steps, running, chars }} />
              </div>
            )}
          </div>

          <Composer
            value={input}
            onChange={setInput}
            onSend={() => void send(input)}
            onStop={stop}
            running={running}
            hasVersion={versions.length > 0}
            demo={health?.mode === "demo"}
          />
        </section>

        <PreviewPanel
          code={code}
          versions={versions}
          activeVersionId={activeVersionId}
          onSelectVersion={selectVersion}
          tab={tab}
          setTab={setTab}
          device={device}
          setDevice={setDevice}
          entries={entries}
          onFix={fixFromConsole}
          onExport={exportHtml}
          onOpen={openExternal}
          reloadTick={reloadTick}
          onReload={reloadPreview}
          running={running}
          chars={chars}
        />
      </div>

      <div className="mobile-switch" role="group" aria-label="切换视图">
        <button className={mobileView === "chat" ? "active" : ""} onClick={() => setMobileView("chat")}>
          <Icon.chat size={13} /> 对话
        </button>
        <button
          className={mobileView === "preview" ? "active" : ""}
          onClick={() => setMobileView("preview")}
        >
          <Icon.eye size={13} /> 预览
        </button>
      </div>

      {toastMsg && (
        <div className="toast" role="status">
          <Icon.spark size={13} /> {toastMsg}
        </div>
      )}
    </div>
  );
}
