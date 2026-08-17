import { getDb } from "./db";
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

const METRICS: Metric[] = ["temperature", "vibration"];

interface GeneratedPoint {
  value: number;
  severity: Severity | null;
  mean: number;
  std: number;
}

function generateNextValue(
  db: ReturnType<typeof getDb>,
  equipmentId: number,
  metric: Metric
): GeneratedPoint | null {
  const rows = db
    .prepare(
      `SELECT ${metric} as v FROM readings WHERE equipment_id = ? ORDER BY timestamp DESC LIMIT ?`
    )
    .all(equipmentId, WINDOW) as { v: number }[];
  if (rows.length < WINDOW) return null; // not enough history yet — skip until seed has caught up

  const window = rows.map((r) => r.v).reverse();
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

/** Appends however many simulated hourly readings have "arrived" since the
 * equipment's last real-time check-in, judging each new point against the
 * same rolling baseline the batch detector uses — the live-streaming
 * counterpart to scripts/seed.ts's one-shot historical batch. */
export function catchUpEquipment(equipmentId: number): number {
  const db = getDb();
  const latestReading = db
    .prepare("SELECT MAX(timestamp) as ts FROM readings WHERE equipment_id = ?")
    .get(equipmentId) as { ts: string | null };
  if (!latestReading.ts) return 0; // no seed data yet for this equipment

  const nowMs = Date.now();
  const state = db
    .prepare("SELECT last_sim_at FROM sim_state WHERE equipment_id = ?")
    .get(equipmentId) as { last_sim_at: string } | undefined;

  if (!state) {
    // First time this equipment is seen by the simulator. Anchor the
    // real-time clock to now without generating a backlog — the seed
    // already brought the data timestamp up to "now" at seed time.
    db.prepare(
      "INSERT INTO sim_state (equipment_id, last_sim_at) VALUES (?, ?)"
    ).run(equipmentId, new Date(nowMs).toISOString());
    return 0;
  }

  const lastSimMs = new Date(state.last_sim_at).getTime();
  const realSecondsElapsed = (nowMs - lastSimMs) / 1000;
  let simulatedHours = Math.floor(realSecondsElapsed * SIM_HOURS_PER_REAL_SECOND);
  if (simulatedHours <= 0) return 0;
  simulatedHours = Math.min(simulatedHours, MAX_CATCHUP_HOURS);

  const lastDataMs = new Date(latestReading.ts).getTime();
  const insertReading = db.prepare(
    "INSERT INTO readings (equipment_id, timestamp, temperature, vibration) VALUES (?, ?, ?, ?)"
  );
  const insertEvent = db.prepare(
    `INSERT INTO anomaly_events
      (equipment_id, timestamp, metric, value, baseline_mean, baseline_std, severity)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  let newEvents = 0;

  for (let h = 1; h <= simulatedHours; h++) {
    const ts = new Date(lastDataMs + h * 60 * 60 * 1000).toISOString();
    const points: Partial<Record<Metric, GeneratedPoint>> = {};

    let missingHistory = false;
    for (const metric of METRICS) {
      const point = generateNextValue(db, equipmentId, metric);
      if (!point) {
        missingHistory = true;
        break;
      }
      points[metric] = point;
    }
    if (missingHistory) break; // insufficient history — stop, don't skip a gap in time

    insertReading.run(equipmentId, ts, points.temperature!.value, points.vibration!.value);

    for (const metric of METRICS) {
      const point = points[metric]!;
      if (point.severity) {
        insertEvent.run(
          equipmentId,
          ts,
          metric,
          point.value,
          point.mean,
          point.std,
          point.severity
        );
        newEvents++;
      }
    }
  }

  // Advance the real-time reference by exactly the real time that elapsed
  // (now), never by the simulated amount — this is what keeps the two
  // clocks from cross-contaminating on the next call.
  db.prepare("UPDATE sim_state SET last_sim_at = ? WHERE equipment_id = ?").run(
    new Date(nowMs).toISOString(),
    equipmentId
  );

  return newEvents;
}

export function catchUpAllEquipment(): void {
  const db = getDb();
  const ids = db.prepare("SELECT id FROM equipment").all() as { id: number }[];
  for (const { id } of ids) catchUpEquipment(id);
}
