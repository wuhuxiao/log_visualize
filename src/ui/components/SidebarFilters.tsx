import type { ChangeEvent } from "react";
import type { EventType, FilterState, LogSource } from "../../types/models";
import { SAMPLE_LOGS } from "../../sample-data";

interface SidebarFiltersProps {
  filters: FilterState;
  workerIds: string[];
  pids: number[];
  dpRanks: number[];
  sources: LogSource[];
  onFiltersChange: (filters: FilterState) => void;
  onFilesSelected: (files: FileList | null) => void;
  onLoadSample: (sampleIds: string[]) => void;
  onExportJson: () => void;
}

const eventTypes: EventType[] = ["request", "scheduler", "uc_task", "prefix_cache", "status", "unknown"];

function toggleValue<T extends string | number>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function SidebarFilters({
  filters,
  workerIds,
  pids,
  dpRanks,
  sources,
  onFiltersChange,
  onFilesSelected,
  onLoadSample,
  onExportJson
}: SidebarFiltersProps) {
  const onUpload = (event: ChangeEvent<HTMLInputElement>) => {
    onFilesSelected(event.target.files);
    event.target.value = "";
  };

  return (
    <aside className="sidebar">
      <section className="panel-section">
        <h2>数据源</h2>
        <label className="file-input-label">
          <span>上传日志</span>
          <input type="file" accept=".log,.txt" multiple onChange={onUpload} />
        </label>
        <div className="button-stack">
          <button type="button" onClick={() => onLoadSample(["demo"])}>
            加载样例 demo
          </button>
          <button type="button" onClick={() => onLoadSample(["demo", "mixed-workers"])}>
            加载多文件样例
          </button>
          <button type="button" onClick={() => onLoadSample(SAMPLE_LOGS.map((sample) => sample.id))}>
            全部样例
          </button>
          <button type="button" onClick={onExportJson}>
            导出归一化 JSON
          </button>
        </div>
        <div className="source-list">
          {sources.map((source) => (
            <div key={source.id} className="source-chip">
              {source.name}
            </div>
          ))}
        </div>
      </section>

      <section className="panel-section">
        <h2>过滤</h2>
        <input
          className="search-input"
          placeholder="搜索 llmMgrReqId / EngineReqId / seqId"
          value={filters.searchText}
          onChange={(event) => onFiltersChange({ ...filters, searchText: event.target.value })}
        />
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={filters.onlyAnomalies}
            onChange={(event) => onFiltersChange({ ...filters, onlyAnomalies: event.target.checked })}
          />
          仅看异常
        </label>
      </section>

      <section className="panel-section">
        <h2>Worker / PID</h2>
        <div className="check-grid">
          {workerIds.map((workerId) => (
            <label key={workerId} className="checkbox-row">
              <input
                type="checkbox"
                checked={filters.workerIds.includes(workerId)}
                onChange={() => onFiltersChange({ ...filters, workerIds: toggleValue(filters.workerIds, workerId) })}
              />
              {workerId}
            </label>
          ))}
        </div>
        <div className="check-grid compact">
          {pids.map((pid) => (
            <label key={pid} className="checkbox-row">
              <input
                type="checkbox"
                checked={filters.pids.includes(pid)}
                onChange={() => onFiltersChange({ ...filters, pids: toggleValue(filters.pids, pid) })}
              />
              {pid}
            </label>
          ))}
        </div>
      </section>

      <section className="panel-section">
        <h2>DP Rank / 类型</h2>
        <div className="check-grid compact">
          {dpRanks.map((dpRank) => (
            <label key={dpRank} className="checkbox-row">
              <input
                type="checkbox"
                checked={filters.dpRanks.includes(dpRank)}
                onChange={() => onFiltersChange({ ...filters, dpRanks: toggleValue(filters.dpRanks, dpRank) })}
              />
              rank {dpRank}
            </label>
          ))}
        </div>
        <div className="check-grid">
          {eventTypes.map((eventType) => (
            <label key={eventType} className="checkbox-row">
              <input
                type="checkbox"
                checked={filters.eventTypes.includes(eventType)}
                onChange={() =>
                  onFiltersChange({ ...filters, eventTypes: toggleValue(filters.eventTypes, eventType) })
                }
              />
              {eventType}
            </label>
          ))}
        </div>
      </section>
    </aside>
  );
}
