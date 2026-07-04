> Imported canon from GardenOS `docs/spatial-model.md` at commit `dec1acf7b9429c42adc022135a0f20552eebb00f`; read-only reference for Ymir design work.

# Midgard Spatial and Garden Record

## Identity and ownership

`Property`, `SpatialArea`, and `PhysicalFeature` use immutable Midgard-level IDs. Import `sourceRef` values are aliases used for idempotent upserts; they are never foreign keys or canonical identity.

Every area and feature belongs directly to a property. A feature may optionally belong to an area and to a containing physical feature. Beds and containers are physical features with a one-to-one `PlantingSpace` extension, allowing structures and inventory locations to reuse the same physical-feature model.

A greenhouse is a physical feature of kind `greenhouse`. Benches, shelves, seed trays, and containers can reference it through `parentFeatureId`, preserving both their property placement and their containment hierarchy.

## Coordinate convention

GardenOS declares one persisted convention: `gardenos-local-si-v1`.

- Length is stored in meters and area in square meters.
- Property-local axes are `+X east`, `+Y north`, and `+Z up`.
- Headings are degrees clockwise from north: 0° north, 90° east, 180° south, 270° west.
- Polygon rings are closed; the final point repeats the first.
- An optional WGS84 longitude/latitude/altitude origin anchors the local property frame to Earth.

The only heading-to-XY implementation is `headingToXY` in `src/services/spatial.ts`:

```text
x = distance × sin(heading)
y = distance × cos(heading)
```

Angles are converted to radians inside that function. Callers must not reimplement this conversion.

## Boundary and measurements

The property boundary is authoritative. Property area and bounding-box measurements are derived by `deriveBoundaryMeasurements`; they are deliberately absent from persistence and imports.

## Feature spatial fields

- `position`: placement transform in the property coordinate frame.
- `geometry`: feature-local footprint before placement.
- `dimensions`: nominal human-facing size, independent of footprint and placement.

## Temporal garden record

A `Season` belongs to a property. A `Planting` represents one biological cohort and records its profile, establishment season and method, lifespan, source, and lifecycle dates. `PlantingSeason` associates that cohort with every season in which it is established, active, harvested, dormant, or removed. This lets trees and other perennials remain one stable planting record across years. An `Outcome` records germination, yield, pests, disease, success rating, and notes for one planting in one season, allowing a perennial to accumulate distinct yearly outcomes.

Each planting may have one or more `PlantingOccupancy` records, and each occupancy names its planting space. An occupancy combines:

- a dated interval within the planting's season;
- placement and footprint in planting-space-local coordinates;
- a numeric vertical envelope, including negative root-zone depths;
- quantity, planting pattern, in-row spacing, and row spacing.

There is deliberately no uniqueness or non-overlap constraint on occupancies. Concurrent overlapping occupancies represent intensive interplanting, while identical footprints with non-overlapping dates represent succession planting. Separate vertical envelopes support groundcover, understory, canopy, trellis, and hanging layers without imposing a fixed list of levels.

Because space belongs to the occupancy rather than the planting, one seed-started cohort can occupy an indoor tray, then a greenhouse shelf, then an outdoor bed. Overlapping occupancy dates allow partial moves and staggered transplanting.

`PlantingEvent` records asynchronous cohort events such as sowing, germination, potting up, greenhouse moves, hardening off, transplanting, dormancy, and resumed growth. Events may reference source and destination planting spaces and the quantity affected, so different parts of a cohort need not change simultaneously.

Trees are modeled as woody-perennial plantings, not as garden beds. Their planting-space occupancies may span multiple seasons and use separate root-zone and canopy occupancies when spatial competition needs to be represented.

## Biological lifecycle and cultivation strategy

The model keeps botanical lifecycle separate from management:

- `biologicalLifecycle`: annual, biennial, perennial, or woody perennial.
- `cultivationStrategy`: single season, overwintered, or multi-season.

This avoids incorrectly relabeling an annual as a perennial merely because it was protected through winter. For example, an annual pepper retained indoors is `annual` plus `overwintered`; an established fruit tree is `woody_perennial` plus `multi_season`.

`Overwintering` is a first-class bridge from one season to the next. It records method, status, dates, source and destination planting spaces, and notes. Supported methods include remaining outdoors, protected outdoor culture, greenhouse culture, indoor culture, and dormant storage. Dated occupancies and planting events record the actual moves independently, including partial-cohort moves.

Lifecycle dates on `Planting` describe biological events. Occupancy dates describe when that crop reserves or uses a particular portion of the planting space; they are related but not interchangeable.

`PlantingSpace` has no authored status column. Its garden status is derived from plantings in the active season by `derivePlantingSpaceGardenStatus`.
