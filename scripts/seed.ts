import { getDb } from "../lib/db";
import { detectAnomalies } from "../lib/anomaly";
import type { Metric } from "../lib/types";


const EQUIPMENT = [
  { name: "1호기 압축기", type: "compressor", location: "A동 1층" },
  { name: "2호기 모터펌프", type: "pump", location: "A동 1층" },
  { name: "컨베이어 벨트 라인 3", type: "conveyor", location: "B동 2층" },
  { name: "냉각탑 유닛 1", type: "cooling_tower", location: "옥상" },
];

const HOURS = 24 * 14; // 14일치 시간당 데이터
const WINDOW = 24;

interface SeriesSpec {
  metric: Metric;
  baseline: number;
  noise: number;
  anomalies: { start: number; length: number; magnitude: number }[];
}

function buildSeries(spec: SeriesSpec): number[] {
  const values: number[] = [];
  for (let i = 0; i < HOURS; i++) {
    let v = spec.baseline + (Math.random() - 0.5) * 2 * spec.noise;

    for (const a of spec.anomalies) {
      if (i >= a.start && i < a.start + a.length) {
        const progress = (i - a.start) / a.length;
        v += a.magnitude * Math.sin(progress * Math.PI);
      }
    }

    values.push(Number(v.toFixed(2)));
  }
  return values;
}

function timestampFor(hourIndex: number): string {
  const start = Date.now() - HOURS * 60 * 60 * 1000;
  return new Date(start + hourIndex * 60 * 60 * 1000).toISOString();
}

function seed() {
  const db = getDb();

  db.exec(
    "DELETE FROM anomaly_events; DELETE FROM readings; DELETE FROM equipment;"
  );

  const insertEquipment = db.prepare(
    "INSERT INTO equipment (name, type, location) VALUES (?, ?, ?)"
  );
  const insertReading = db.prepare(
    "INSERT INTO readings (equipment_id, timestamp, temperature, vibration) VALUES (?, ?, ?, ?)"
  );
  const insertEvent = db.prepare(
    `INSERT INTO anomaly_events
      (equipment_id, timestamp, metric, value, baseline_mean, baseline_std, severity)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const specsByEquipment: Record<string, { temperature: SeriesSpec; vibration: SeriesSpec }> = {
    "1호기 압축기": {
      temperature: {
        metric: "temperature",
        baseline: 68,
        noise: 1.5,
        anomalies: [{ start: 220, length: 18, magnitude: 22 }],
      },
      vibration: {
        metric: "vibration",
        baseline: 3.2,
        noise: 0.25,
        anomalies: [{ start: 260, length: 10, magnitude: 4.5 }],
      },
    },
    "2호기 모터펌프": {
      temperature: {
        metric: "temperature",
        baseline: 55,
        noise: 1.2,
        anomalies: [],
      },
      vibration: {
        metric: "vibration",
        baseline: 2.4,
        noise: 0.2,
        anomalies: [{ start: 150, length: 14, magnitude: 3.8 }],
      },
    },
    "컨베이어 벨트 라인 3": {
      temperature: {
        metric: "temperature",
        baseline: 40,
        noise: 1.0,
        anomalies: [{ start: 90, length: 12, magnitude: 15 }],
      },
      vibration: {
        metric: "vibration",
        baseline: 1.8,
        noise: 0.15,
        anomalies: [],
      },
    },
    "냉각탑 유닛 1": {
      temperature: {
        metric: "temperature",
        baseline: 30,
        noise: 0.8,
        anomalies: [],
      },
      vibration: {
        metric: "vibration",
        baseline: 1.2,
        noise: 0.1,
        anomalies: [{ start: 300, length: 20, magnitude: 3.0 }],
      },
    },
  };

  for (const eq of EQUIPMENT) {
    const { lastInsertRowid } = insertEquipment.run(eq.name, eq.type, eq.location);
    const equipmentId = Number(lastInsertRowid);

    const specs = specsByEquipment[eq.name];
    const temperature = buildSeries(specs.temperature);
    const vibration = buildSeries(specs.vibration);

    for (let i = 0; i < HOURS; i++) {
      insertReading.run(equipmentId, timestampFor(i), temperature[i], vibration[i]);
    }

    for (const [metric, values] of [
      ["temperature", temperature],
      ["vibration", vibration],
    ] as [Metric, number[]][]) {
      const anomalies = detectAnomalies(values, metric, WINDOW);
      for (const a of anomalies) {
        insertEvent.run(
          equipmentId,
          timestampFor(a.index),
          a.metric,
          a.value,
          a.baselineMean,
          a.baselineStd,
          a.severity
        );
      }
    }

    console.log(`시드 완료: ${eq.name} (id=${equipmentId})`);
  }

  console.log("전체 시드 데이터 생성 완료.");
}

seed();
