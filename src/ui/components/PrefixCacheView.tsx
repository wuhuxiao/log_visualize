import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { NormalizedRequest, ParsedEvent, PrefixCacheAssociation } from "../../types/models";

interface PrefixCacheViewProps {
  events: ParsedEvent[];
  requests: NormalizedRequest[];
  associations: PrefixCacheAssociation[];
  onSelectRequest: (requestId: string) => void;
}

export function PrefixCacheView({ events, requests, associations, onSelectRequest }: PrefixCacheViewProps) {
  const prefixEvents = events.filter(
    (event) => event.eventType === "prefix_cache" && "scope" in event && event.scope === "request"
  );

  const rows = prefixEvents.map((event) => {
    const association = associations.find((item) => item.eventId === event.id);
    const request = association?.requestId ? requests.find((item) => item.id === association.requestId) : undefined;
    return {
      id: event.id,
      requestId: request?.id,
      llmMgrReqId: request?.llmMgrReqId ?? request?.llmMgrReqIdRaw ?? "unmatched",
      localHitRate: Number(event.extracted.localHitRate ?? 0),
      remoteHitRate: Number(event.extracted.remoteHitRate ?? 0),
      hitRate: Number(event.extracted.hitRate ?? 0),
      localCachedTokens: Number(event.extracted.localCachedTokens ?? 0),
      remoteCachedTokens: Number(event.extracted.remoteCachedTokens ?? 0),
      confidence: association?.confidence ?? "none"
    };
  });

  return (
    <div className="view-grid">
      <div className="chart-panel">
        <h3>Prefix Cache Reporter 命中率</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="llmMgrReqId" stroke="#94a3b8" />
            <YAxis stroke="#94a3b8" />
            <Tooltip contentStyle={{ background: "#101827", border: "1px solid #334155" }} />
            <Bar dataKey="localHitRate" fill="#1d4ed8" />
            <Bar dataKey="remoteHitRate" fill="#0f766e" />
            <Bar dataKey="hitRate" fill="#f59e0b" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="table-panel">
        <h3>请求级 Prefix Cache Reporter</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>request</th>
              <th>local tokens</th>
              <th>remote tokens</th>
              <th>local hit</th>
              <th>remote hit</th>
              <th>total hit</th>
              <th>关联置信度</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} onClick={() => row.requestId && onSelectRequest(row.requestId)}>
                <td>{row.llmMgrReqId}</td>
                <td>{row.localCachedTokens}</td>
                <td>{row.remoteCachedTokens}</td>
                <td>{row.localHitRate}%</td>
                <td>{row.remoteHitRate}%</td>
                <td>{row.hitRate}%</td>
                <td>{row.confidence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
