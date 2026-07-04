/**
 * GardenOS import adapter — the first consumer proof (canon §9).
 *
 * Mapping spec: docs/reference/spatial-model.md (inherited, read-only).
 *   GardenOS Property        → Ymir Property (ID, name, boundary, WGS84 anchor)
 *   GardenOS SpatialArea     → Ymir SpatialArea (ID, name, geometry, purpose)
 *   GardenOS PhysicalFeature → Ymir PhysicalFeature (ID, kind, position,
 *                              geometry, dimensions, parentFeatureId containment)
 *   GardenOS PlantingSpace   → stays in the garden app; the adapter records
 *                              only the link (metadata.garden.planting_space_id)
 *                              per R-DOMAIN-002 — domain data never enters core.
 *
 * Coordinate frames transfer unchanged: gardenos-local-si-v1 and
 * ymir-local-si-v1 are the same convention under two names (canon §2.1).
 *
 * sourceRef values are aliases for idempotent upserts, never canonical
 * identity (canon §1.2, R-STORE-004: strict matching). Midgard-level IDs are
 * stable and carry forward as Ymir IDs (canon §9.1).
 */

import type {
  AreaKind,
  FeatureKind,
  Polygon,
  Transform,
  ValidationWarning,
  Wgs84Origin,
} from "../types.js";
import { YmirValidationError } from "../types.js";
import type { YmirEngine } from "../engine.js";
import { upsertFeatureBySourceRef } from "../porting.js";

// -- GardenOS wire shapes ----------------------------------------------------
// The reference doc specifies the model, not a serialization; these shapes are
// the adapter's faithful reading of it (RULINGS_ADDENDUM A-006).

export interface GardenOSProperty {
  id: string;
  name: string;
  boundary: Polygon;
  wgs84Origin?: Wgs84Origin;
}

export interface GardenOSArea {
  id: string;
  sourceRef?: string;
  propertyId: string;
  name: string;
  purpose?: string;
  geometry: Polygon;
}

export interface GardenOSFeature {
  id: string;
  sourceRef?: string;
  propertyId: string;
  areaId?: string;
  parentFeatureId?: string;
  name: string;
  kind: string;
  position: Transform;
  geometry?: Polygon;
  dimensions?: { width_m: number; depth_m: number; height_m: number };
  /** present when the feature has a one-to-one PlantingSpace extension */
  plantingSpaceId?: string;
}

export interface GardenOSExport {
  property: GardenOSProperty;
  areas: GardenOSArea[];
  features: GardenOSFeature[];
}

// -- kind mappings ------------------------------------------------------------

/** GardenOS feature kinds → Ymir core kinds. Unmapped kinds become 'unknown' with a warning (R-DOMAIN-003). */
const FEATURE_KIND_MAP: Record<string, FeatureKind> = {
  bed: "planting_bed",
  raised_bed: "raised_bed",
  container: "container",
  greenhouse: "greenhouse",
  shed: "shed",
  bench: "shelf",
  shelf: "shelf",
  seed_tray: "container",
  trellis: "trellis",
  tree: "tree",
  shrub: "shrub",
  path: "pathway",
  fence: "fence",
  water_feature: "water_feature",
};

/** GardenOS area purposes → Ymir AreaKind. Default: outdoor_garden. */
const AREA_KIND_MAP: Record<string, AreaKind> = {
  garden: "outdoor_garden",
  yard: "outdoor_yard",
  patio: "outdoor_patio",
  driveway: "outdoor_driveway",
  path: "outdoor_path",
  greenhouse_interior: "covered_structure",
};

export function mapGardenOSFeatureKind(kind: string): { kind: FeatureKind; mapped: boolean } {
  const mapped = FEATURE_KIND_MAP[kind];
  if (mapped) return { kind: mapped, mapped: true };
  return { kind: "unknown", mapped: false };
}

export interface GardenOSImportResult {
  property_id: string;
  areas_created: number;
  features_created: number;
  features_updated: number;
  warnings: ValidationWarning[];
  /** GardenOS feature id → Ymir feature id (identical when IDs carry forward) */
  feature_id_map: Map<string, string>;
}

/**
 * Import a GardenOS export. Idempotent: re-running against the same data
 * updates via strict source_ref matching instead of duplicating (R-STORE-004).
 */
export function importGardenOS(engine: YmirEngine, data: GardenOSExport): GardenOSImportResult {
  const warnings: ValidationWarning[] = [];
  const featureIdMap = new Map<string, string>();

  // Property: carry the Midgard-level ID forward; on re-import, reuse it.
  const propertyId = data.property.id;
  const existing = (() => {
    try {
      return engine.getProperty(propertyId);
    } catch {
      return undefined;
    }
  })();
  if (!existing) {
    engine.createProperty({
      id: propertyId,
      name: data.property.name,
      boundary: data.property.boundary,
      wgs84_origin: data.property.wgs84Origin,
    });
  }

  // Areas: create-once by carried-forward ID (areas have no spatial mutation
  // path in GardenOS imports; geometry changes arrive as area re-imports later).
  let areasCreated = 0;
  for (const area of data.areas) {
    if (area.propertyId !== data.property.id) {
      throw new YmirValidationError(
        "unknown_reference",
        `GardenOS area ${area.id} references property ${area.propertyId}, not ${data.property.id}`,
      );
    }
    const already = engine.getAreas(propertyId).some((a) => a.id === area.id);
    if (already) continue;
    const kind = AREA_KIND_MAP[area.purpose ?? "garden"] ?? "outdoor_garden";
    engine.addArea(propertyId, {
      id: area.id,
      name: area.name,
      kind,
      purpose: kind === "outdoor_garden" ? "garden_zone" : "cultivation",
      geometry: area.geometry,
    });
    areasCreated += 1;
  }

  // Features: parents before children so parentFeatureId references resolve
  // (a greenhouse before its benches, benches before their trays — canon §1.1
  // inheritance: containment hierarchy preserved alongside property placement).
  const ordered = topoSortFeatures(data.features);

  let created = 0;
  let updated = 0;
  for (const gf of ordered) {
    if (gf.propertyId !== data.property.id) {
      throw new YmirValidationError(
        "unknown_reference",
        `GardenOS feature ${gf.id} references property ${gf.propertyId}, not ${data.property.id}`,
      );
    }
    const { kind, mapped } = mapGardenOSFeatureKind(gf.kind);
    if (!mapped) {
      warnings.push({
        code: "unknown_kind",
        message: `GardenOS feature ${gf.id} ('${gf.name}') has unmapped kind '${gf.kind}' — imported as 'unknown' (R-DOMAIN-003)`,
        subject_id: gf.id,
      });
    }

    // sourceRef alias: prefer the explicit GardenOS sourceRef; otherwise the
    // stable GardenOS id itself becomes the alias for idempotent re-imports.
    const sourceRef = gf.sourceRef ?? `gardenos:${gf.id}`;

    const metadata: Record<string, unknown> = {
      garden: {
        gardenos_id: gf.id,
        gardenos_kind: gf.kind,
        ...(gf.plantingSpaceId ? { planting_space_id: gf.plantingSpaceId } : {}),
      },
    };

    const result = upsertFeatureBySourceRef(engine, propertyId, sourceRef, {
      id: gf.id,
      name: gf.name,
      kind,
      position: gf.position,
      geometry: gf.geometry,
      dimensions: gf.dimensions,
      parent_area_id: gf.areaId,
      parent_feature_id: gf.parentFeatureId ? featureIdMap.get(gf.parentFeatureId) ?? gf.parentFeatureId : undefined,
      metadata,
    });
    featureIdMap.set(gf.id, result.feature.id);
    warnings.push(...result.warnings);
    if (result.created) created += 1;
    else updated += 1;
  }

  return {
    property_id: propertyId,
    areas_created: areasCreated,
    features_created: created,
    features_updated: updated,
    warnings,
    feature_id_map: featureIdMap,
  };
}

/** Order features so containment parents precede their children. */
function topoSortFeatures(features: GardenOSFeature[]): GardenOSFeature[] {
  const byId = new Map(features.map((f) => [f.id, f]));
  const visited = new Set<string>();
  const out: GardenOSFeature[] = [];
  const visit = (f: GardenOSFeature, chain: Set<string>): void => {
    if (visited.has(f.id)) return;
    if (chain.has(f.id)) {
      throw new YmirValidationError(
        "circular_containment",
        `GardenOS import: containment cycle involving feature ${f.id}`,
      );
    }
    chain.add(f.id);
    if (f.parentFeatureId) {
      const parent = byId.get(f.parentFeatureId);
      if (parent) visit(parent, chain);
    }
    chain.delete(f.id);
    visited.add(f.id);
    out.push(f);
  };
  for (const f of features) visit(f, new Set());
  return out;
}
