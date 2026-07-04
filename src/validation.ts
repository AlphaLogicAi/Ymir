/**
 * Validation (canon §4.4, v1.1 — aligned to locked rulings).
 *
 * Validates (rejects):
 *   - circular containment (R-CONSTRAINT-002)
 *   - temporal inconsistency (to before from)
 *   - duplicate IDs within property scope
 *   - missing required fields / invalid kinds / unclosed rings
 *
 * Warns (records, does not reject by default):
 *   - centroid outside container (R-CONSTRAINT-003 — strict mode upgrades to
 *     rejection; force mode proceeds anyway with a logged override)
 *
 * Never validated (recorded only): feature overlap (R-CONSTRAINT-001),
 * structural safety, domain lifecycle rules.
 */

import type {
  PhysicalFeature,
  Polygon,
  SpatialArea,
  TemporalEnvelope,
  ValidationWarning,
} from "./types.js";
import { isValidFeatureKind, YmirValidationError } from "./types.js";
import { isClosedRing, placedCentroid, pointInPolygon } from "./geometry.js";

export function assertClosedPolygon(poly: Polygon, subject: string): void {
  if (!poly.ring || poly.ring.length < 4 || !isClosedRing(poly.ring)) {
    throw new YmirValidationError(
      "invalid_geometry",
      `${subject}: polygon ring must be closed (final point repeats the first) with at least 3 distinct vertices`,
    );
  }
}

export function assertTemporalConsistency(env: TemporalEnvelope, subject: string): void {
  if (env.to !== undefined && env.to < env.from) {
    throw new YmirValidationError(
      "temporal_inconsistency",
      `${subject}: temporal envelope 'to' (${env.to}) precedes 'from' (${env.from})`,
    );
  }
}

export function assertValidKind(kind: string, subject: string): void {
  if (!isValidFeatureKind(kind)) {
    throw new YmirValidationError(
      "invalid_kind",
      `${subject}: '${kind}' is neither a core FeatureKind nor a 'domain:' namespaced kind (canon §3.3.1)`,
    );
  }
}

/**
 * Circular containment detection (R-CONSTRAINT-002: detect and reject).
 * Walks parent_feature_id links from the proposed parent; if the walk reaches
 * the feature being placed, the write is rejected.
 */
export function assertNoContainmentCycle(
  featureId: string,
  proposedParentId: string | undefined,
  getParentOf: (id: string) => string | undefined,
): void {
  let current = proposedParentId;
  const visited = new Set<string>();
  while (current !== undefined) {
    if (current === featureId) {
      throw new YmirValidationError(
        "circular_containment",
        `feature ${featureId}: setting parent ${proposedParentId} creates a containment cycle`,
      );
    }
    if (visited.has(current)) return; // pre-existing cycle elsewhere; not introduced by this write
    visited.add(current);
    current = getParentOf(current);
  }
}

/**
 * Centroid containment check (R-CONSTRAINT-003, canon §4.4):
 * the feature's placed centroid must fall within the container's geometry.
 * Returns a warning when it does not (or when within boundary tolerance);
 * callers upgrade to rejection under strict mode.
 */
export function checkCentroidContainment(
  feature: Pick<PhysicalFeature, "id" | "position" | "geometry">,
  container: { id: string; geometry: Polygon; label: string },
): ValidationWarning | undefined {
  const centroid = placedCentroid(feature.position, feature.geometry);
  if (!pointInPolygon(centroid, container.geometry)) {
    return {
      code: "centroid_outside_container",
      message: `feature ${feature.id}: placed centroid (${centroid.x.toFixed(2)}, ${centroid.y.toFixed(2)}) falls outside ${container.label} ${container.id}`,
      subject_id: feature.id,
    };
  }
  return undefined;
}

/** Containment context resolution: a feature is checked against its parent area, else parent feature footprint, else the property boundary. */
export function resolveContainer(
  feature: Pick<PhysicalFeature, "parent_area_id" | "parent_feature_id">,
  lookup: {
    getArea: (id: string) => SpatialArea | undefined;
    getFeature: (id: string) => PhysicalFeature | undefined;
    propertyBoundary: Polygon;
    propertyId: string;
  },
): { id: string; geometry: Polygon; label: string } {
  if (feature.parent_area_id) {
    const area = lookup.getArea(feature.parent_area_id);
    if (!area) {
      throw new YmirValidationError(
        "unknown_reference",
        `parent_area_id ${feature.parent_area_id} does not exist`,
      );
    }
    return { id: area.id, geometry: area.geometry, label: "area" };
  }
  if (feature.parent_feature_id) {
    const parent = lookup.getFeature(feature.parent_feature_id);
    if (!parent) {
      throw new YmirValidationError(
        "unknown_reference",
        `parent_feature_id ${feature.parent_feature_id} does not exist`,
      );
    }
    if (parent.geometry) {
      // Parent footprint is feature-local; place it in the property frame via its transform.
      // For containment purposes we check against the parent's placed footprint by
      // translating the child's placed centroid into the same frame — the simple,
      // sufficient v0.1 approach: check against parent's placed footprint ring.
      const placedRing = parent.geometry.ring.map((p) => ({
        x: p.x + parent.position.x,
        y: p.y + parent.position.y,
      }));
      return { id: parent.id, geometry: { ring: placedRing }, label: "parent feature" };
    }
    // Parent has no footprint: fall through to property boundary.
  }
  return { id: lookup.propertyId, geometry: lookup.propertyBoundary, label: "property boundary" };
}
