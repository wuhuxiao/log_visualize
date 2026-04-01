import type { ChangeEvent } from "react";
import type { EventType, FilterState, LogSource } from "../../types/models";

interface SidebarFiltersProps {
  filters: FilterState;
  workerIds: string[];
  pids: number[];
  dpRanks: number[];
  availableEventTypes: EventType[];
  sources: LogSource[];
  onFiltersChange: (filters: FilterState) => void;
  onFilesSelected: (files: FileList | null) => void;
  onExportJson: () => void;
}

export function SidebarFilters({
  filters,
  sources,
  onFiltersChange,
  onFilesSelected,
  onExportJson
}: SidebarFiltersProps) {
  const onUpload = (event: ChangeEvent<HTMLInputElement>) => {
    onFilesSelected(event.target.files);
    event.target.value = "";
  };

  return (
    <aside className="sidebar">
      <section className="panel-section">
        <h2>Data</h2>
        <label className="file-input-label">
          <span>Upload logs</span>
          <input type="file" accept=".log,.txt" multiple onChange={onUpload} />
        </label>
        <div className="button-stack">
          <button type="button" onClick={onExportJson}>
            Export normalized JSON
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
        <h2>Filters</h2>
        <input
          className="search-input"
          placeholder="Search llmMgrReqId / EngineReqId / seqId"
          value={filters.searchText}
          onChange={(event) => onFiltersChange({ ...filters, searchText: event.target.value })}
        />
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={filters.onlyAnomalies}
            onChange={(event) => onFiltersChange({ ...filters, onlyAnomalies: event.target.checked })}
          />
          Only anomalous requests
        </label>
      </section>

      <section className="panel-section">
        <h2>Custom Request Thresholds</h2>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={filters.customRequestThresholds.enabled}
            onChange={(event) =>
              onFiltersChange({
                ...filters,
                customRequestThresholds: {
                  ...filters.customRequestThresholds,
                  enabled: event.target.checked
                }
              })
            }
          />
          Enable threshold filtering
        </label>
        <div className="threshold-grid">
          <label className="threshold-field">
            <span>Cache load bandwidth &lt;= MB/s</span>
            <input
              type="number"
              min="0"
              step="0.1"
              value={filters.customRequestThresholds.maxCacheLoadBandwidthMBps ?? ""}
              onChange={(event) =>
                onFiltersChange({
                  ...filters,
                  customRequestThresholds: {
                    ...filters.customRequestThresholds,
                    maxCacheLoadBandwidthMBps:
                      event.target.value === "" ? undefined : Number(event.target.value)
                  }
                })
              }
            />
          </label>
          <label className="threshold-field">
            <span>Cache dump bandwidth &lt;= MB/s</span>
            <input
              type="number"
              min="0"
              step="0.1"
              value={filters.customRequestThresholds.maxCacheDumpBandwidthMBps ?? ""}
              onChange={(event) =>
                onFiltersChange({
                  ...filters,
                  customRequestThresholds: {
                    ...filters.customRequestThresholds,
                    maxCacheDumpBandwidthMBps:
                      event.target.value === "" ? undefined : Number(event.target.value)
                  }
                })
              }
            />
          </label>
          <label className="threshold-field">
            <span>Model compute &gt;= ms</span>
            <input
              type="number"
              min="0"
              step="1"
              value={filters.customRequestThresholds.minModelComputeMs ?? ""}
              onChange={(event) =>
                onFiltersChange({
                  ...filters,
                  customRequestThresholds: {
                    ...filters.customRequestThresholds,
                    minModelComputeMs:
                      event.target.value === "" ? undefined : Number(event.target.value)
                  }
                })
              }
            />
          </label>
        </div>
      </section>
    </aside>
  );
}
