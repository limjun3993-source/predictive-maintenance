import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import type { AnomalyEvent, Equipment, EquipmentSummary, Metric, Reading, Severity } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "app.db");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

declare global {
  var __db: Database.Database | undefined;
}

export function getDb(): Database.Database {
  if (!global.__db) {
    global.__db = new Database(DB_PATH);
    global.__db.pragma("journal_mode = WAL");
    initSchema(global.__db);
  }
  return global.__db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS equipment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      location TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_id INTEGER NOT NULL REFERENCES equipment(id),
      timestamp TEXT NOT NULL,
      temperature REAL NOT NULL,
      vibration REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_readings_equipment ON readings(equipment_id, timestamp);

    CREATE TABLE IF NOT EXISTS anomaly_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_id INTEGER NOT NULL REFERENCES equipment(id),
      timestamp TEXT NOT NULL,
      metric TEXT NOT NULL,
      value REAL NOT NULL,
      baseline_mean REAL NOT NULL,
      baseline_std REAL NOT NULL,
      severity TEXT NOT NULL,
      ai_explanation TEXT,
      ai_recommendation TEXT,
      estimated_savings_krw REAL,
      explained_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_events_equipment ON anomaly_events(equipment_id, timestamp);

    -- Tracks real wall-clock time separately from the readings' own
    -- (compressed-rate) timestamps, so lib/simulate.ts can tell how much
    -- real time actually passed since it last generated data. See the
    -- comment in lib/simulate.ts for why these two clocks can't be the
    -- same column.
    CREATE TABLE IF NOT EXISTS sim_state (
      equipment_id INTEGER PRIMARY KEY REFERENCES equipment(id),
      last_sim_at TEXT NOT NULL
    );
  `);
}

const STATUS_WINDOW_HOURS = 48;
const SEVERITY_RANK: Record<Severity, number> = { warning: 1, critical: 2 };

export function getEquipmentIds(): number[] {
  const db = getDb();
  return (db.prepare("SELECT id FROM equipment").all() as { id: number }[]).map((r) => r.id);
}

export function getLatestReadingTimestamp(equipmentId: number): string | null {
  const db = getDb();
  return (
    db
      .prepare("SELECT MAX(timestamp) as ts FROM readings WHERE equipment_id = ?")
      .get(equipmentId) as { ts: string | null }
  ).ts;
}

export function insertReading(
  equipmentId: number,
  timestamp: string,
  temperature: number,
  vibration: number
): void {
  getDb()
    .prepare(
      "INSERT INTO readings (equipment_id, timestamp, temperature, vibration) VALUES (?, ?, ?, ?)"
    )
    .run(equipmentId, timestamp, temperature, vibration);
}

export function insertAnomalyEvent(event: {
  equipmentId: number;
  timestamp: string;
  metric: Metric;
  value: number;
  baselineMean: number;
  baselineStd: number;
  severity: Severity;
}): void {
  getDb()
    .prepare(
      `INSERT INTO anomaly_events
        (equipment_id, timestamp, metric, value, baseline_mean, baseline_std, severity)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      event.equipmentId,
      event.timestamp,
      event.metric,
      event.value,
      event.baselineMean,
      event.baselineStd,
      event.severity
    );
}

export function getEquipmentSummaries(): EquipmentSummary[] {
  const db = getDb();
  const equipment = db.prepare("SELECT * FROM equipment ORDER BY id").all() as Equipment[];

  const recentEventsStmt = db.prepare(
    `SELECT severity FROM anomaly_events
     WHERE equipment_id = ? AND timestamp >= ?`
  );
  const activeCountStmt = db.prepare(
    `SELECT COUNT(*) as c FROM anomaly_events
     WHERE equipment_id = ? AND timestamp >= ?`
  );

  return equipment.map((eq) => {
    const latestReadingAt = getLatestReadingTimestamp(eq.id);
    const cutoff = latestReadingAt
      ? new Date(new Date(latestReadingAt).getTime() - STATUS_WINDOW_HOURS * 60 * 60 * 1000).toISOString()
      : "";

    const recentSeverities = latestReadingAt
      ? (recentEventsStmt.all(eq.id, cutoff) as { severity: Severity }[])
      : [];
    const activeEventCount = latestReadingAt
      ? (activeCountStmt.get(eq.id, cutoff) as { c: number }).c
      : 0;

    const status = recentSeverities.reduce<Severity | "normal">((worst, ev) => {
      if (worst === "normal") return ev.severity;
      return SEVERITY_RANK[ev.severity] > SEVERITY_RANK[worst] ? ev.severity : worst;
    }, "normal");

    return { ...eq, status, activeEventCount, latestReadingAt };
  });
}

export function getEquipmentById(id: number): Equipment | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM equipment WHERE id = ?").get(id) as Equipment | undefined;
}

export function getReadingsForEquipment(equipmentId: number): Reading[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM readings WHERE equipment_id = ? ORDER BY timestamp")
    .all(equipmentId) as Reading[];
}

export function getEventsForEquipment(equipmentId: number): AnomalyEvent[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM anomaly_events WHERE equipment_id = ? ORDER BY timestamp DESC")
    .all(equipmentId) as AnomalyEvent[];
}

export function getEventById(id: number): AnomalyEvent | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM anomaly_events WHERE id = ?").get(id) as AnomalyEvent | undefined;
}

export function saveEventInsight(
  id: number,
  insight: { explanation: string; recommendation: string; estimatedSavingsKrw: number }
): void {
  const db = getDb();
  db.prepare(
    `UPDATE anomaly_events
     SET ai_explanation = ?, ai_recommendation = ?, estimated_savings_krw = ?, explained_at = ?
     WHERE id = ?`
  ).run(
    insight.explanation,
    insight.recommendation,
    insight.estimatedSavingsKrw,
    new Date().toISOString(),
    id
  );
}
