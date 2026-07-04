# Ymir Core

**The shared spatial engine for modeling physical property** — the single source of spatial truth beneath multiple consumer apps. Ymir knows the shape of the user's physical world: land and structures, outdoors and indoors, as one continuous model. A raised garden bed and a bookshelf are ontological peers: physical features occupying space, with location, dimensions, and history.

## Canon

This library implements locked canon — it makes no design decisions of its own:

- **[docs/YMIR_SPATIAL_ARCHITECTURE.md](docs/YMIR_SPATIAL_ARCHITECTURE.md)** (v1.1) — the schema and architecture canon
- **[docs/RULINGS_NEEDED.md](docs/RULINGS_NEEDED.md)** — all 26 design rulings, locked
- **[docs/RULINGS_ADDENDUM.md](docs/RULINGS_ADDENDUM.md)** — provisional choices for gaps implementation surfaced (each needs a confirm-or-overturn ruling)
- **[docs/reference/](docs/reference/)** — inherited, read-only: the GardenOS spatial model (mapping spec for the first consumer) and the Bifrost design-system constraint reference

## What it does

- **One continuous model** — `Property` → `SpatialArea` (yards, rooms) → `PhysicalFeature` (trees, beds, furniture, structures), with structures containing indoor spaces. Hybrid `FeatureKind`: a core enum plus `domain:<name>` extension without schema changes.
- **One coordinate convention** — `ymir-local-si-v1`: SI meters, +X east / +Y north / +Z up, headings clockwise from north, closed polygon rings, optional WGS84 anchor. Centimeter precision.
- **Positional versioning (the flagship)** — every spatial write lands in an append-only `spatial_changes` log (retained forever) with before/after snapshots. `propertyAt(date)` reconstructs **full as-of spatial state** by change-log replay: a bed moved five times since March is returned at wherever it stood in March.
- **Validation per canon §4.4** — containment cycles and temporal inconsistencies reject unconditionally; centroid containment warns by default, rejects under `strict`, and `force` proceeds with a logged override.
- **Event log for consumers** — in-process subscription plus cursor-based `getChangesSince` polling, so the garden app and interior app each learn what the other changed.
- **Import/export** — fixed-schema JSON export (the change log travels with the property, so history survives migration); imports reject property-ID conflicts with a rename offer; strict `source_ref` upserts keep re-imports idempotent.
- **GardenOS adapter** — the first consumer proof: maps the inherited garden spatial model (IDs carry forward, containment preserved, `PlantingSpace` stays domain-side as a metadata link).

## Usage

```ts
import { YmirEngine } from "ymir-core";

const ymir = new YmirEngine("estate.db"); // or ":memory:"

const property = ymir.createProperty({
  name: "Homestead",
  boundary: { ring: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }, { x: 0, y: 0 }] },
}).value;

const bed = ymir.addFeature(property.id, {
  name: "Raised Bed 1",
  kind: "raised_bed",
  position: { x: 10, y: 5 },
  dimensions: { width_m: 1.2, depth_m: 2.4, height_m: 0.3 },
}, { at: "2024-03-01" }).value;

ymir.moveFeature(bed.id, { x: 12, y: 8 }, { at: "2024-04-15" });

// The flagship: full as-of spatial state, via change-log replay
ymir.propertyAt(property.id, "2024-03-20").features[0].position; // → { x: 10, y: 5 }
ymir.getFeature(bed.id).position;                                 // → { x: 12, y: 8 }
```

## Engine/consumer boundary

Ymir owns spatial truth: geometry, position, dimensions, containment, temporal lifecycle. Consumer apps own their domain data (plantings and seasons; assets and maintenance) in their own stores, referencing Ymir feature IDs — never forking spatial state. All writes flow through this API and are logged; consumers may cache, but the log is ground truth.

## Development

Requires Node ≥ 22 (`.nvmrc` provided).

```sh
npm install
npm test          # vitest — acceptance tests are mapped to canon sections
npm run typecheck
npm run build
```

## Status

v0.1 — core engine, storage, temporal replay, event log, import/export, GardenOS adapter. Designed-for-later (not yet built): visualization layers, photo/scan capture, deep maintenance integration, environmental modeling, multi-user access, service-mode API.
