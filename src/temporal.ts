/**
 * Temporal engine (canon §5, §5.4 — positional versioning).
 *
 * Change-log replay is the AUTHORITY: property_at(date) and feature_history()
 * are defined purely in terms of replaying spatial_changes up to and
 * including the target date. Current-state tables are a projection; this
 * module never reads them for historical answers.
 *
 * Every mutating event carries `details.entity` — the full post-change entity
 * — alongside the canonical before/after spatial snapshots. Replay applies
 * entities in (timestamp, seq) order, so the log alone reconstructs full
 * as-of state (RULINGS_ADDENDUM A-004).
 */

import type {
  ISO8601,
  PhysicalFeature,
  SpatialAdjacency,
  SpatialArea,
  SpatialChange,
} from "./types.js";

/**
 * Normalize an ISO 8601 input to a full UTC datetime string for storage and
 * lexicographic comparison (R-TIME-001: time-of-day optional, defaults to
 * start of day). Date-only inputs become T00:00:00.000Z.
 */
export function normalizeTimestamp(input: ISO8601): ISO8601 {
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return `${input}T00:00:00.000Z`;
  }
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`invalid ISO 8601 timestamp: ${input}`);
  }
  return parsed.toISOString();
}

/**
 * Interval activity test: envelope [from, to] is inclusive at instant
 * granularity (RULINGS_ADDENDUM A-003). Assumes normalized timestamps.
 */
export function activeAt(env: { from: ISO8601; to?: ISO8601 }, date: ISO8601): boolean {
  return env.from <= date && (env.to === undefined || date <= env.to);
}

export interface ReplayedState {
  areas: Map<string, SpatialArea>;
  features: Map<string, PhysicalFeature>;
  adjacencies: Map<string, SpatialAdjacency>;
}

/**
 * Replay a change log (already ordered by timestamp, seq — YmirStorage
 * guarantees this) into entity state. Callers bound the log to the target
 * date BEFORE calling; replay applies everything it is given.
 */
export function replayChanges(changes: SpatialChange[]): ReplayedState {
  const state: ReplayedState = {
    areas: new Map(),
    features: new Map(),
    adjacencies: new Map(),
  };

  for (const change of changes) {
    const entity = change.details["entity"];
    switch (change.event_kind) {
      case "property_created":
        break; // boundary is immutable in v1 (R-TIME-002); nothing to replay
      case "area_added":
      case "area_modified":
      case "area_removed":
        if (entity) {
          const area = entity as SpatialArea;
          state.areas.set(area.id, area);
        }
        break;
      case "feature_added":
      case "feature_moved":
      case "feature_resized":
      case "feature_regeometried":
      case "feature_recontained":
      case "feature_status_changed":
      case "feature_removed":
        if (entity) {
          const feature = entity as PhysicalFeature;
          state.features.set(feature.id, feature);
        }
        break;
      case "adjacency_added":
        if (entity) {
          const adj = entity as SpatialAdjacency;
          state.adjacencies.set(adj.id, adj);
        }
        break;
      default:
        // Unknown event kinds are preserved in the log but ignored by replay
        // (forward compatibility: R-IMPL-002 upgrade-on-load posture).
        break;
    }
  }

  return state;
}

/**
 * Filter replayed state down to entities whose temporal envelope covers
 * `date`. Removed-before-date features drop out; removed-after-date features
 * appear in their as-of spatial state (canon §5.2: full as-of spatial state,
 * not merely as-of existence).
 */
export function stateActiveAt(state: ReplayedState, date: ISO8601): {
  areas: SpatialArea[];
  features: PhysicalFeature[];
  adjacencies: SpatialAdjacency[];
} {
  const areas = [...state.areas.values()].filter((a) => activeAt(a.temporal_envelope, date));
  const features = [...state.features.values()].filter((f) => activeAt(f.temporal_envelope, date));
  const activeAreaIds = new Set(areas.map((a) => a.id));
  const adjacencies = [...state.adjacencies.values()].filter(
    (adj) => activeAreaIds.has(adj.area1_id) && activeAreaIds.has(adj.area2_id),
  );
  return { areas, features, adjacencies };
}
