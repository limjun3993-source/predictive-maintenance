import {
  getDb,
  getEquipmentIds,
  getEquipmentSummaries,
  getEventsForEquipment,
  getLatestReadingTimestamp,
  getReadingsForEquipment,
  insertAnomalyEvent,
  insertReading,
} from "./db";
import { baselineStats, classifySeverity } from "./anomaly";
import type { Metric, Severity } from "./types";

const WINDOW = 24;

// Demo time compression: real elapsed time is compressed so the dashboard
// visibly grows during a short demo instead of needing literal hours to
// pass. 1 simulated sensor-hour arrives every 10 real seconds.
//
// This rate is tracked against `sim_state.last_sim_at` (real wall-clock
// time), never against the readings' own `timestamp` column. Each
// generated reading's timestamp still advances by one real calendar hour
// (so the data looks like normal hourly telemetry) — which means the
// stored timestamp races ~360x ahead of real time. Comparing "now" against
// that raced-ahead value would make every subsequent check see a
// last-reading-time in the future and permanently stop generating data.
// `last_sim_at` is a separate column that only ever advances by the real
// time that actually elapsed, so the two clocks can't cross-contaminate.
const SIM_HOURS_PER_REAL_SECOND = 1 / 10;

// Caps how much a single request can generate if the site was idle for a
// long time (e.g. asleep on Railway's serverless tier for days) — without
// this, the first visit after a long gap would synchronously generate and
// insert thousands of rows before responding.
const MAX_CATCHUP_HOURS = 72;

// Per generated hour, chance of injecting a single-point spike large enough
// to trip CRITICAL_Z, so a demo viewer who waits ~30-60s has a good chance
// of watching a fresh anomaly get caught in real time.
const ANOMALY_CHANCE_PER_HOUR = 0.08;
const ANOMALY_MAGNITUDE_MIN_SIGMA = 6;
const ANOMALY_MAGNITUDE_MAX_SIGMA = 16;

interface GeneratedPoint {
  value: number;
  severity: Severity | null;
  mean: number;
  std: number;
}

/** Draws the next value from a trailing window (oldest-first) without
 * touching the DB — the window is kept in memory and advanced by the
 * caller across hours instead of re-querying it every iteration. */
function generateNextValue(window: number[]): GeneratedPoint {
  const { mean, std } = baselineStats(window);
  const noiseStd = std > 0 ? std : Math.max(Math.abs(mean) * 0.02, 0.05);

  let value = mean + (Math.random() - 0.5) * 2 * noiseStd;

  if (Math.random() < ANOMALY_CHANCE_PER_HOUR) {
    const sigma =
      ANOMALY_MAGNITUDE_MIN_SIGMA +
      Math.random() * (ANOMALY_MAGNITUDE_MAX_SIGMA - ANOMALY_MAGNITUDE_MIN_SIGMA);
    const direction = Math.random() < 0.5 ? -1 : 1;
    value += direction * sigma * noiseStd;
  }

  value = Number(value.toFixed(2));
  const severity = std > 0 ? classifySeverity(Math.abs((value - mean) / std)) : null;

  return { value, severity, mean, std };
}

function getRecentValues(
  db: ReturnType<typeof getDb>,
  equipmentId: number,
  metric: Metric
): number[] {
  const rows = db
    .prepare(
      `SELECT ${metric} as v FROM readings WHERE equipment_id = ? ORDER BY timestamp DESC LIMIT ?`
    )
    .all(equipmentId, WINDOW) as { v: number }[];
  return rows.map((r) => r.v).reverse();
}

/** Appends however many simulated hourly readings have "arrived" since the
 * equipment's last real-time check-in, judging each new point against the
 * same rolling baseline the batch detector uses — the live-streaming
 * counterpart to scripts/seed.ts's one-shot historical batch. */
export function catchUpEquipment(equipmentId: number): number {
  const db = getDb();
  const latestTs = getLatestReadingTimestamp(equipmentId);
  if (!latestTs) return 0; // no seed data yet for this equipment

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const state = db
    .prepare("SELECT last_sim_at FROM sim_state WHERE equipment_id = ?")
    .get(equipmentId) as { last_sim_at: string } | undefined;

  if (!state) {
    // First time this equipment is seen by the simulator. Anchor the
    // real-time clock to now without generating a backlog — the seed
    // already brought the data timestamp up to "now" at seed time.
    db.prepare("INSERT INTO sim_state (equipment_id, last_sim_at) VALUES (?, ?)").run(
      equipmentId,
      nowIso
    );
    return 0;
  }

  const realSecondsElapsed = (nowMs - new Date(state.last_sim_at).getTime()) / 1000;
  let simulatedHours = Math.floor(realSecondsElapsed * SIM_HOURS_PER_REAL_SECOND);
  if (simulatedHours <= 0) return 0;
  simulatedHours = Math.min(simulatedHours, MAX_CATCHUP_HOURS);

  const windows: Record<Metric, number[]> = {
    temperature: getRecentValues(db, equipmentId, "temperature"),
    vibration: getRecentValues(db, equipmentId, "vibration"),
  };
  const touchSimState = () =>
    db.prepare("UPDATE sim_state SET last_sim_at = ? WHERE equipment_id = ?").run(nowIso, equipmentId);

  if (windows.temperature.length < WINDOW || windows.vibration.length < WINDOW) {
    // Not enough history to judge a new point against yet (shouldn't happen
    // post-seed, but keep this from spinning on every request if it does).
    touchSimState();
    return 0;
  }

  const lastDataMs = new Date(latestTs).getTime();
  let newEvents = 0;

  const runCatchUp = db.transaction((hours: number) => {
    for (let h = 1; h <= hours; h++) {
      const ts = new Date(lastDataMs + h * 60 * 60 * 1000).toISOString();

      const temp = generateNextValue(windows.temperature);
      const vib = generateNextValue(windows.vibration);
      insertReading(equipmentId, ts, temp.value, vib.value);
      windows.temperature.push(temp.value);
      windows.temperature.shift();
      windows.vibration.push(vib.value);
      windows.vibration.shift();

      for (const [metric, point] of [
        ["temperature", temp],
        ["vibration", vib],
      ] as [Metric, GeneratedPoint][]) {
        if (point.severity) {
          insertAnomalyEvent({
            equipmentId,
            timestamp: ts,
            metric,
            value: point.value,
            baselineMean: point.mean,
            baselineStd: point.std,
            severity: point.severity,
          });
          newEvents++;
        }
      }
    }
  });
  runCatchUp(simulatedHours);
  touchSimState();

  return newEvents;
}

function catchUpAllEquipment(): void {
  for (const id of getEquipmentIds()) catchUpEquipment(id);
}

// Live-data facade: every read path goes through one of these three
// functions rather than each route remembering to call catch-up before
// querying, so freshness can't silently be skipped by a future call site.
export function getLiveEquipmentSummaries() {
  catchUpAllEquipment();
  return getEquipmentSummaries();
}

export function getLiveReadings(equipmentId: number) {
  catchUpEquipment(equipmentId);
  return getReadingsForEquipment(equipmentId);
}

export function getLiveEvents(equipmentId: number) {
  catchUpEquipment(equipmentId);
  return getEventsForEquipment(equipmentId);
}
