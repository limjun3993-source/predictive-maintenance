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

const STATUS_STYLE: Record<EquipmentSummary["status"], string> = {
  normal: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  critical: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

const SEVERITY_STYLE: Record<AnomalyEvent["severity"], string> = {
  warning: "border-amber-400 text-amber-700 dark:text-amber-300",
  critical: "border-red-400 text-red-700 dark:text-red-300",
};

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

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <header className="border-b border-zinc-200 px-8 py-6 dark:border-zinc-800">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          예지보전 대시보드
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          설비 센서 이상 징후 탐지 및 AI 기반 조치 권장
        </p>
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
              className={`w-full rounded-lg border p-4 text-left transition-colors ${
                eq.id === selectedId
                  ? "border-zinc-900 bg-white dark:border-zinc-100 dark:bg-zinc-900"
                  : "border-zinc-200 bg-white/60 hover:bg-white dark:border-zinc-800 dark:bg-zinc-900/40 dark:hover:bg-zinc-900"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-zinc-900 dark:text-zinc-50">{eq.name}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[eq.status]}`}>
                  {STATUS_LABEL[eq.status]}
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {eq.type} · {eq.location}
              </p>
              {eq.activeEventCount > 0 && (
                <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                  최근 48시간 이상 이벤트 {eq.activeEventCount}건
                </p>
              )}
            </button>
          ))}
          {equipment.length === 0 && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              설비 데이터가 없습니다. <code>npm run seed</code>로 시드 데이터를 생성하세요.
            </p>
          )}
        </aside>

        <main className="flex-1 space-y-6">
          {selected && (
            <>
              <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
                <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                  {selected.name} 센서 추이
                </h2>
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="timestamp" tick={{ fontSize: 11 }} minTickGap={40} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="온도" stroke="#f97316" dot={false} strokeWidth={1.5} />
                      <Line type="monotone" dataKey="진동" stroke="#3b82f6" dot={false} strokeWidth={1.5} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
                <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                  이상 이벤트 ({events.length})
                </h2>
                {insightError && (
                  <p className="mb-3 text-sm text-red-600 dark:text-red-400">{insightError}</p>
                )}
                <div className="space-y-3">
                  {events.map((ev) => (
                    <div
                      key={ev.id}
                      className={`rounded-lg border-l-4 bg-zinc-50 p-4 dark:bg-zinc-950/40 ${SEVERITY_STYLE[ev.severity]}`}
                    >
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-zinc-900 dark:text-zinc-50">
                          {ev.metric === "temperature" ? "온도" : "진동"} 이상 · {formatTime(ev.timestamp)}
                        </span>
                        <span className="text-zinc-500 dark:text-zinc-400">
                          측정값 {ev.value.toFixed(2)} (평균 {ev.baseline_mean.toFixed(2)} ±{" "}
                          {ev.baseline_std.toFixed(2)})
                        </span>
                      </div>

                      {ev.ai_explanation ? (
                        <div className="mt-3 space-y-1.5 text-sm">
                          <p className="text-zinc-700 dark:text-zinc-300">{ev.ai_explanation}</p>
                          <p className="text-zinc-700 dark:text-zinc-300">
                            <span className="font-medium">권장 조치: </span>
                            {ev.ai_recommendation}
                          </p>
                          {ev.estimated_savings_krw != null && (
                            <p className="font-medium text-emerald-700 dark:text-emerald-400">
                              예상 절감액: {formatKrw(ev.estimated_savings_krw)}원
                            </p>
                          )}
                        </div>
                      ) : (
                        <button
                          onClick={() => handleGenerateInsight(ev.id)}
                          disabled={insightLoadingId === ev.id}
                          className="mt-3 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                        >
                          {insightLoadingId === ev.id ? "AI 분석 중..." : "AI 설명 생성"}
                        </button>
                      )}
                    </div>
                  ))}
                  {events.length === 0 && (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
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
