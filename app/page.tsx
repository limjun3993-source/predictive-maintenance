"use client";

import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AnomalyEvent, EquipmentSummary, Reading } from "@/lib/types";

const STATUS_LABEL: Record<EquipmentSummary["status"], string> = {
  normal: "정상",
  warning: "주의",
  critical: "위험",
};

const STATUS_VAR: Record<EquipmentSummary["status"], string> = {
  normal: "var(--status-good)",
  warning: "var(--status-warning)",
  critical: "var(--status-critical)",
};

const STATUS_BG_VAR: Record<EquipmentSummary["status"], string> = {
  normal: "var(--status-good-bg)",
  warning: "var(--status-warning-bg)",
  critical: "var(--status-critical-bg)",
};

function StatusIcon({ status, size = 14 }: { status: EquipmentSummary["status"]; size?: number }) {
  const color = STATUS_VAR[status];
  if (status === "normal") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="6.5" stroke={color} strokeWidth="1.6" />
        <path d="M5.2 8.2l1.8 1.8 3.8-4" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === "warning") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M8 2.2l6.2 10.8H1.8L8 2.2z" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M8 6.6v3" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="8" cy="11.6" r="0.9" fill={color} />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" stroke={color} strokeWidth="1.6" />
      <path d="M8 4.8v4" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="11.2" r="0.9" fill={color} />
    </svg>
  );
}

function StatusBadge({ status }: { status: EquipmentSummary["status"] }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ background: STATUS_BG_VAR[status], color: STATUS_VAR[status] }}
    >
      <StatusIcon status={status} size={12} />
      {STATUS_LABEL[status]}
    </span>
  );
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatKrw(value: number) {
  return new Intl.NumberFormat("ko-KR").format(Math.round(value));
}

interface ChartTooltipPayloadItem {
  dataKey: string;
  value: number;
  color: string;
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: ChartTooltipPayloadItem[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-sm"
      style={{
        background: "var(--surface-1)",
        borderColor: "var(--border)",
        color: "var(--text-secondary)",
      }}
    >
      <div className="mb-1.5 font-medium" style={{ color: "var(--text-muted)" }}>
        {label}
      </div>
      {payload.map((item) => (
        <div key={item.dataKey} className="flex items-center gap-2 py-0.5">
          <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: item.color }} />
          <span style={{ color: "var(--text-primary)" }} className="font-semibold tabular-nums">
            {item.value.toFixed(2)}
          </span>
          <span>{item.dataKey}</span>
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const [equipment, setEquipment] = useState<EquipmentSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [events, setEvents] = useState<AnomalyEvent[]>([]);
  const [insightLoadingId, setInsightLoadingId] = useState<number | null>(null);
  const [insightError, setInsightError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/equipment")
      .then((res) => res.json())
      .then((data: EquipmentSummary[]) => {
        setEquipment(data);
        if (data.length > 0) setSelectedId(data[0].id);
      });
  }, []);

  useEffect(() => {
    if (selectedId == null) return;
    fetch(`/api/equipment/${selectedId}/readings`)
      .then((res) => res.json())
      .then(setReadings);
    fetch(`/api/equipment/${selectedId}/events`)
      .then((res) => res.json())
      .then(setEvents);
  }, [selectedId]);

  const selected = equipment.find((eq) => eq.id === selectedId) ?? null;

  async function handleGenerateInsight(eventId: number) {
    setInsightLoadingId(eventId);
    setInsightError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/insight`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "AI 설명 생성에 실패했습니다.");
      setEvents((prev) => prev.map((ev) => (ev.id === eventId ? data : ev)));
    } catch (err) {
      setInsightError(err instanceof Error ? err.message : "AI 설명 생성에 실패했습니다.");
    } finally {
      setInsightLoadingId(null);
    }
  }

  const chartData = readings.map((r) => ({
    timestamp: formatTime(r.timestamp),
    온도: r.temperature,
    진동: r.vibration,
  }));

  const statusCounts = {
    normal: equipment.filter((eq) => eq.status === "normal").length,
    warning: equipment.filter((eq) => eq.status === "warning").length,
    critical: equipment.filter((eq) => eq.status === "critical").length,
  };

  return (
    <div className="flex flex-1 flex-col" style={{ background: "var(--page-plane)" }}>
      <header className="border-b px-8 py-6" style={{ borderColor: "var(--border)" }}>
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
          예지보전 대시보드
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          설비 센서 이상 징후 탐지 및 AI 기반 조치 권장
        </p>

        <div className="mt-5 flex gap-3">
          <div
            className="rounded-lg border px-4 py-3"
            style={{ borderColor: "var(--border)", background: "var(--surface-1)" }}
          >
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              전체 설비
            </p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
              {equipment.length}
            </p>
          </div>
          {(["critical", "warning", "normal"] as const).map((status) => (
            <div
              key={status}
              className="rounded-lg border px-4 py-3"
              style={{ borderColor: "var(--border)", background: "var(--surface-1)" }}
            >
              <p className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
                <StatusIcon status={status} size={11} />
                {STATUS_LABEL[status]}
              </p>
              <p
                className="mt-0.5 text-xl font-semibold tabular-nums"
                style={{ color: statusCounts[status] > 0 ? STATUS_VAR[status] : "var(--text-primary)" }}
              >
                {statusCounts[status]}
              </p>
            </div>
          ))}
        </div>
      </header>

      <div className="flex flex-1 gap-6 p-8">
        <aside className="w-72 shrink-0 space-y-3">
          {equipment.map((eq) => (
            <button
              key={eq.id}
              onClick={() => {
                setSelectedId(eq.id);
                setInsightError(null);
              }}
              className="w-full rounded-lg border-l-[3px] border-y border-r p-4 text-left transition-colors"
              style={{
                borderLeftColor: STATUS_VAR[eq.status],
                borderTopColor: "var(--border)",
                borderRightColor: "var(--border)",
                borderBottomColor: "var(--border)",
                background: eq.id === selectedId ? "var(--surface-1)" : "transparent",
                boxShadow: eq.id === selectedId ? "0 1px 2px rgba(0,0,0,0.04)" : "none",
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium" style={{ color: "var(--text-primary)" }}>
                  {eq.name}
                </span>
                <StatusBadge status={eq.status} />
              </div>
              <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                {eq.type} · {eq.location}
              </p>
              {eq.activeEventCount > 0 && (
                <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                  최근 48시간 이상 이벤트 {eq.activeEventCount}건
                </p>
              )}
            </button>
          ))}
          {equipment.length === 0 && (
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              설비 데이터가 없습니다. <code>npm run seed</code>로 시드 데이터를 생성하세요.
            </p>
          )}
        </aside>

        <main className="flex-1 space-y-6">
          {selected && (
            <>
              <section
                className="rounded-lg border p-6"
                style={{ borderColor: "var(--border)", background: "var(--surface-1)" }}
              >
                <h2 className="mb-4 text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
                  {selected.name} 센서 추이
                </h2>
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid stroke="var(--gridline)" vertical={false} />
                      <XAxis
                        dataKey="timestamp"
                        tick={{ fontSize: 11, fill: "var(--text-muted)" }}
                        axisLine={{ stroke: "var(--axis)" }}
                        tickLine={false}
                        minTickGap={40}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: "var(--text-muted)" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip content={<ChartTooltip />} cursor={{ stroke: "var(--axis)" }} />
                      <Legend
                        wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)" }}
                        iconType="plainline"
                      />
                      <Line
                        type="monotone"
                        dataKey="온도"
                        stroke="var(--series-temperature)"
                        dot={false}
                        strokeWidth={2}
                      />
                      <Line
                        type="monotone"
                        dataKey="진동"
                        stroke="var(--series-vibration)"
                        dot={false}
                        strokeWidth={2}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section
                className="rounded-lg border p-6"
                style={{ borderColor: "var(--border)", background: "var(--surface-1)" }}
              >
                <h2 className="mb-4 text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
                  이상 이벤트 ({events.length})
                </h2>
                {insightError && (
                  <p className="mb-3 text-sm" style={{ color: "var(--status-critical)" }}>
                    {insightError}
                  </p>
                )}
                <div className="space-y-3">
                  {events.map((ev) => (
                    <div
                      key={ev.id}
                      className="rounded-lg border-l-[3px] p-4"
                      style={{
                        borderLeftColor: STATUS_VAR[ev.severity === "critical" ? "critical" : "warning"],
                        background: "var(--page-plane)",
                      }}
                    >
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="flex items-center gap-1.5 font-medium" style={{ color: "var(--text-primary)" }}>
                          <StatusIcon status={ev.severity === "critical" ? "critical" : "warning"} size={13} />
                          {ev.metric === "temperature" ? "온도" : "진동"} 이상 · {formatTime(ev.timestamp)}
                        </span>
                        <span className="tabular-nums" style={{ color: "var(--text-muted)" }}>
                          측정값 {ev.value.toFixed(2)} (평균 {ev.baseline_mean.toFixed(2)} ±{" "}
                          {ev.baseline_std.toFixed(2)})
                        </span>
                      </div>

                      {ev.ai_explanation ? (
                        <div className="mt-3 space-y-1.5 text-sm">
                          <p style={{ color: "var(--text-secondary)" }}>{ev.ai_explanation}</p>
                          <p style={{ color: "var(--text-secondary)" }}>
                            <span className="font-medium" style={{ color: "var(--text-primary)" }}>
                              권장 조치:{" "}
                            </span>
                            {ev.ai_recommendation}
                          </p>
                          {ev.estimated_savings_krw != null && (
                            <p className="font-medium tabular-nums" style={{ color: "var(--status-good)" }}>
                              예상 절감액: {formatKrw(ev.estimated_savings_krw)}원
                            </p>
                          )}
                        </div>
                      ) : (
                        <button
                          onClick={() => handleGenerateInsight(ev.id)}
                          disabled={insightLoadingId === ev.id}
                          className="mt-3 rounded-md px-3 py-1.5 text-xs font-medium transition-opacity disabled:opacity-50"
                          style={{ background: "var(--text-primary)", color: "var(--surface-1)" }}
                        >
                          {insightLoadingId === ev.id ? "AI 분석 중..." : "AI 설명 생성"}
                        </button>
                      )}
                    </div>
                  ))}
                  {events.length === 0 && (
                    <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                      해당 설비에 감지된 이상 이벤트가 없습니다.
                    </p>
                  )}
                </div>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
