/**
 * Ymir Core — shared spatial engine for modeling physical property.
 *
 * Canon: docs/YMIR_SPATIAL_ARCHITECTURE.md v1.1 (locked)
 * Rulings: docs/RULINGS_NEEDED.md (all locked) + docs/RULINGS_ADDENDUM.md
 */

export * from "./types.js";
export {
  headingToXY,
  exposureDirection,
  roundCm,
  normalizeHeading,
  polygonArea,
  polygonCentroid,
  boundingBox,
  pointInPolygon,
  placedCentroid,
  deriveBoundaryMeasurements,
  isClosedRing,
  closeRing,
} from "./geometry.js";
export { YmirStorage } from "./storage.js";
export {
  YmirEngine,
  type PropertySpec,
  type AreaSpec,
  type FeatureSpec,
  type FeatureFilter,
  type Unsubscribe,
  type ChangeListener,
} from "./engine.js";
export { normalizeTimestamp, activeAt, replayChanges, stateActiveAt } from "./temporal.js";
export {
  exportProperty,
  importProperty,
  renameExportForImport,
  upsertFeatureBySourceRef,
  type ImportResult,
} from "./porting.js";
export {
  importGardenOS,
  mapGardenOSFeatureKind,
  type GardenOSExport,
  type GardenOSProperty,
  type GardenOSArea,
  type GardenOSFeature,
  type GardenOSImportResult,
} from "./adapters/gardenos.js";
