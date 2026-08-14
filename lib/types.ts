export type Metric = "temperature" | "vibration";
export type Severity = "warning" | "critical";
export type EquipmentStatus = "normal" | "warning" | "critical";

export interface Equipment {
  id: number;
  name: string;
  type: string;
  location: string;
}

export interface Reading {
  id: number;
  equipment_id: number;
  timestamp: string;
  temperature: number;
  vibration: number;
}

export interface AnomalyEvent {
  id: number;
  equipment_id: number;
  timestamp: string;
  metric: Metric;
  value: number;
  baseline_mean: number;
  baseline_std: number;
  severity: Severity;
  ai_explanation: string | null;
  ai_recommendation: string | null;
  estimated_savings_krw: number | null;
  explained_at: string | null;
}

export interface EquipmentSummary extends Equipment {
  status: EquipmentStatus;
  activeEventCount: number;
  latestReadingAt: string | null;
}
