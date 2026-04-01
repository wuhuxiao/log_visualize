import { useEffect, useMemo, useState } from "react";
import { analyzeSources } from "./normalizer";
import { loadSampleSources } from "./sample-data";
import type { FilterState, LogSource } from "./types/models";
import { DetailPanel } from "./ui/components/DetailPanel";
import { OverviewCards } from "./ui/components/OverviewCards";
import { PrefixCacheView } from "./ui/components/PrefixCacheView";
import { ProcessSummaryView } from "./ui/components/ProcessSummaryView";
import { RequestListView } from "./ui/components/RequestListView";
import { RequestTimelineView } from "./ui/components/RequestTimelineView";
import { SchedulerView } from "./ui/components/SchedulerView";
import { SidebarFilters } from "./ui/components/SidebarFilters";
import { UCTaskTimelineView } from "./ui/components/UCTaskTimelineView";
import { ViewTabs, type ViewKey } from "./ui/components/ViewTabs";
import { filterEvents, filterRequests, filterUCTasks } from "./ui/filtering";

const defaultFilters: FilterState = {
  workerIds: [],
  pids: [],
  dpRanks: [],
  eventTypes: [],
  searchText: "",
  onlyAnomalies: false
};

async function filesToSources(files: FileList): Promise<LogSource[]> {
  return Promise.all(
    [...files].map(async (file, index) => ({
      id: `uploaded-${index}-${file.name}`,
      name: file.name,
      text: await file.text()
    }))
  );
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [sources, setSources] = useState<LogSource[]>([]);
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [activeView, setActiveView] = useState<ViewKey>("process");
  const [selectedRequestId, setSelectedRequestId] = useState<string>();
  const [selectedTaskId, setSelectedTaskId] = useState<string>();
  const [selectedEventId, setSelectedEventId] = useState<string>();
  const [zoom, setZoom] = useState(2);

  useEffect(() => {
    loadSampleSources(["demo", "mixed-workers"]).then(setSources).catch(() => undefined);
  }, []);

  const result = useMemo(() => analyzeSources(sources), [sources]);
  const workerIds = useMemo(() => [...new Set(result.events.map((event) => event.workerId))].sort(), [result.events]);
  const pids = useMemo(
    () =>
      [...new Set(result.events.map((event) => event.pid).filter((pid): pid is number => pid !== undefined))].sort(
        (a, b) => a - b
      ),
    [result.events]
  );
  const dpRanks = useMemo(
    () =>
      [...new Set(result.events.map((event) => event.requestRef?.dpRank).filter((rank): rank is number => rank !== undefined))].sort(
        (a, b) => a - b
      ),
    [result.events]
  );

  const visibleEvents = useMemo(() => filterEvents(result, filters), [filters, result]);
  const visibleRequests = useMemo(() => filterRequests(result, filters, visibleEvents), [filters, result, visibleEvents]);
  const visibleRequestIds = useMemo(() => new Set(visibleRequests.map((request) => request.id)), [visibleRequests]);
  const visibleTasks = useMemo(() => filterUCTasks(result, filters, visibleRequestIds), [filters, result, visibleRequestIds]);
  const visibleTaskIds = useMemo(() => new Set(visibleTasks.map((task) => task.id)), [visibleTasks]);
  const visibleSummaries = useMemo(
    () =>
      result.processSummaries.filter((summary) =>
        visibleTasks.some((task) => task.workerId === summary.workerId && task.category === summary.category)
      ),
    [result.processSummaries, visibleTasks]
  );

  useEffect(() => {
    if (!selectedRequestId && visibleRequests[0]) {
      setSelectedRequestId(visibleRequests[0].id);
    }
  }, [selectedRequestId, visibleRequests]);

  const selectedRequest = visibleRequests.find((request) => request.id === selectedRequestId);
  const selectedTask = visibleTasks.find((task) => task.id === selectedTaskId);
  const selectedEvent = visibleEvents.find((event) => event.id === selectedEventId);

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files?.length) {
      return;
    }
    const uploaded = await filesToSources(files);
    setSources(uploaded);
    setSelectedRequestId(undefined);
    setSelectedTaskId(undefined);
    setSelectedEventId(undefined);
  };

  const handleLoadSample = async (sampleIds: string[]) => {
    const loaded = await loadSampleSources(sampleIds);
    setSources(loaded);
    setSelectedRequestId(undefined);
    setSelectedTaskId(undefined);
    setSelectedEventId(undefined);
  };

  return (
    <div className="app-shell">
      <SidebarFilters
        filters={filters}
        workerIds={workerIds}
        pids={pids}
        dpRanks={dpRanks}
        sources={sources}
        onFiltersChange={setFilters}
        onFilesSelected={handleFilesSelected}
        onLoadSample={handleLoadSample}
        onExportJson={() => downloadJson("normalized-log-analysis.json", result)}
      />

      <main className="main-panel">
        <header className="page-header">
          <div>
            <h1>LLM / UC 日志分析与可视化</h1>
            <p>统一解析多 worker 日志，联动查看请求生命周期、调度行为与 UC task 时间线。</p>
          </div>
          <label className="zoom-control">
            时间线默认缩放
            <input
              type="range"
              min="1"
              max="8"
              step="0.5"
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
            <span>{zoom.toFixed(1)}x</span>
          </label>
        </header>

        <OverviewCards requests={visibleRequests} tasks={visibleTasks} anomalies={result.anomalies} />
        <ViewTabs activeView={activeView} onChange={setActiveView} />

        {activeView === "process" && <ProcessSummaryView summaries={visibleSummaries} />}
        {activeView === "requests" && (
          <RequestListView
            requests={visibleRequests}
            selectedRequestId={selectedRequestId}
            onSelectRequest={(requestId) => {
              setSelectedRequestId(requestId);
              setSelectedTaskId(undefined);
              setSelectedEventId(undefined);
            }}
          />
        )}
        {activeView === "requestTimeline" && (
          <RequestTimelineView
            request={selectedRequest}
            tasks={visibleTasks}
            zoom={zoom}
            onSelectTask={(taskId) => {
              if (visibleTaskIds.has(taskId)) {
                setSelectedTaskId(taskId);
                setSelectedEventId(undefined);
              }
            }}
          />
        )}
        {activeView === "scheduler" && (
          <SchedulerView
            events={visibleEvents}
            tasks={visibleTasks}
            onSelectEvent={(eventId) => {
              setSelectedEventId(eventId);
              setSelectedTaskId(undefined);
            }}
          />
        )}
        {activeView === "ucTimeline" && (
          <UCTaskTimelineView
            tasks={visibleTasks}
            zoom={zoom}
            onSelectTask={(taskId) => {
              setSelectedTaskId(taskId);
              setSelectedEventId(undefined);
            }}
          />
        )}
        {activeView === "prefix" && (
          <PrefixCacheView
            events={visibleEvents}
            requests={visibleRequests}
            associations={result.prefixAssociations}
            onSelectRequest={(requestId) => {
              setSelectedRequestId(requestId);
              setSelectedTaskId(undefined);
              setSelectedEventId(undefined);
            }}
          />
        )}
      </main>

      <DetailPanel
        result={result}
        selectedRequest={selectedRequest}
        selectedTask={selectedTask}
        selectedEvent={selectedEvent}
      />
    </div>
  );
}
