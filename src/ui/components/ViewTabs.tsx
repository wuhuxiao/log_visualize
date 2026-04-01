export type ViewKey =
  | "process"
  | "requests"
  | "requestTimeline"
  | "scheduler"
  | "ucTimeline"
  | "prefix";

const tabs: Array<{ key: ViewKey; label: string }> = [
  { key: "process", label: "进程汇总" },
  { key: "requests", label: "请求列表" },
  { key: "requestTimeline", label: "请求时序" },
  { key: "scheduler", label: "调度视图" },
  { key: "ucTimeline", label: "UC 时间线" },
  { key: "prefix", label: "Prefix Cache" }
];

interface ViewTabsProps {
  activeView: ViewKey;
  onChange: (view: ViewKey) => void;
}

export function ViewTabs({ activeView, onChange }: ViewTabsProps) {
  return (
    <div className="tab-row">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={tab.key === activeView ? "tab-button active" : "tab-button"}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
