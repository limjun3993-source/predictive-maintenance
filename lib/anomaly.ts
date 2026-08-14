import type { Metric, Severity } from "./types";

export interface DetectedAnomaly {
  index: number;
  metric: Metric;
  value: number;
  baselineMean: number;
  baselineStd: number;
  severity: Severity;
}

// Calibrated against a real industrial dataset (Azure PdM: 100 machines, 1yr
// hourly telemetry, 761 labeled failures), not just synthetic seed data.
// At z>=2, this detector's "97% of failures had a flagged point in the 48h
// before" looked strong until compared against a random-timestamp control
// (99.5%) — indistinguishable from chance, because ~7% of all real points
// get flagged, so almost any 48h window contains one regardless of whether
// a failure is coming. z>=3 is the threshold where flagging first shows a
// real, non-chance lift: 44.7% recall vs 37.3% random-baseline recall, and
// alert-level precision of 5.0% vs a 4.17% random baseline (i.e. an alert
// still means "no failure in the next 48h" ~95% of the time). That's real
// signal, not noise — but it's weak. A single vibration z-score is not
// precise enough to act on by itself; treat it as one input, not a
// standalone trigger for dispatching maintenance.
const WARNING_Z = 3;
const CRITICAL_Z = 4;

/**
 * Rolling-window z-score anomaly detection. The baseline for point i is
 * computed from the `windowSize` points before it, so early detection
 * doesn't leak future data (mirrors how this would run in production).
 *
 * Known limitation (validated, not fixed): once an anomaly persists past
 * `windowSize` points, it enters its own trailing baseline and drags the
 * mean/stddev with it, which both suppresses detection deep into a
 * long-running event and can flag the eventual return to normal as a new
 * anomaly. This detector is only reliable for anomalies shorter than
 * `windowSize`; sustained drift needs a different approach.
 *
 * Three attempted fixes were tested against synthetic data and rejected —
 * all three worsened the pure-noise false-positive rate, because all three
 * share the same flaw: they make baseline updates conditional on "does this
 * point look anomalous", which is a self-reinforcing feedback loop (points
 * that look extreme get excluded from ever updating what "normal" means, so
 * normal keeps narrowing, so more points look extreme).
 *   1. Median/MAD baseline — small-window (24pt) MAD has high estimator
 *      variance, so critical-severity false positives rose ~20x.
 *   2. Excluding previously-flagged points from all future windows —
 *      variance-shrinkage death spiral; point-level false-positive rate on
 *      pure noise rose from ~2% to ~9-10%.
 *   3. EWMA baseline that freezes while the current point is flagged and
 *      resumes when calm — same death spiral on pure noise (~8% FP rate),
 *      *and* it fixed the long-anomaly case (near-100% detection at 40h
 *      and 200h durations) but then completely failed the thing it was
 *      supposed to additionally support: a genuine gradual drift (e.g.
 *      benign seasonal warming) never gets incorporated once it's far
 *      enough from the frozen baseline to keep tripping the threshold, so
 *      the baseline locks up and every subsequent point false-positives
 *      (~120 false events per 336-point series in testing).
 *
 * If sustained-drift detection is needed later, don't extend this
 * function's self-referential baseline again — add a separate, simpler,
 * non-adaptive check instead (e.g. compare this week's aggregate against
 * last week's, or against an operator-set reference range).
 */
export function detectAnomalies(
  values: number[],
  metric: Metric,
  windowSize = 24
): DetectedAnomaly[] {
  const anomalies: DetectedAnomaly[] = [];

  for (let i = windowSize; i < values.length; i++) {
    const window = values.slice(i - windowSize, i);
    const mean = average(window);
    const std = stddev(window, mean);
    if (std === 0) continue;

    const z = (values[i] - mean) / std;
    const absZ = Math.abs(z);

    if (absZ >= WARNING_Z) {
      anomalies.push({
        index: i,
        metric,
        value: values[i],
        baselineMean: mean,
        baselineStd: std,
        severity: absZ >= CRITICAL_Z ? "critical" : "warning",
      });
    }
  }

  return anomalies;
}

function average(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddev(xs: number[], mean: number): number {
  const variance = xs.reduce((sum, x) => sum + (x - mean) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
}
