# Ymir — Spatial Engine — Design Session Brief

## What this session is

A deep architecture and modeling session (not a build). The deliverable is a canon document — schema, concepts, and boundaries — that consumer applications will build against. Propose boldly, reason from first principles, and surface every decision that needs a human ruling rather than deciding silently.

## Mission

Design **Ymir**, the shared spatial engine for modeling physical property — the single source of spatial truth beneath multiple consumer apps. Ymir knows the shape of the user's physical world: land and structures, outdoors and indoors, as **one continuous model from day one**. Landscape, gardening, and interior design are all views over the same spatial truth: a property is a single coherent space in which a house is a highly structured feature on the land, rooms are spaces within that feature, and a raised garden bed and a bookshelf are ontological peers — physical features occupying space, with location, dimensions, and history.

## Starting canon (inherit, generalize, do not discard)

The garden-domain spatial model at `docs/reference/spatial-model.md` in this repo is the seed. Its established decisions carry forward:

- Canonical types: Property, SpatialArea, PhysicalFeature, PlantingSpace, Season, Planting — to be **generalized** so indoor concepts (structure, room/space, wall, fixture, furnishing) are peers within the same hierarchy, with PlantingSpace/Season/Planting recognized as one domain's extension of the general model.
- SI units with local coordinate systems; stable long-lived IDs for physical things.
- Domain operational data (e.g., garden records) does not enter the general knowledge store; Ymir is its own system of record for spatial truth.

## What the session must produce

1. **The ontology:** the generalized type system — spatial containers, physical features, and the indoor/outdoor continuum. What is universal (Ymir core) vs. domain extension (garden domain, interior domain). How extensions attach without polluting the core.
2. **Geometry and coordinates:** the local-coordinate convention across nested spaces (property → yard/structure → room → feature), what geometric fidelity is stored (positions, footprints, dimensions — full CAD precision vs. structured approximation, and where on that spectrum each layer sits), and how vertical space (floors, elevation, height) is handled.
3. **The constraint and relationship layer:** containment, adjacency, orientation (sun exposure matters outdoors, window light indoors — possibly the same concept), and what the engine validates vs. merely records.
4. **Time:** properties change — features are added, removed, moved, renovated; seasons cycle. How spatial state is versioned and how "the yard in 2024" remains reconstructable.
5. **The engine/consumer boundary:** exactly what Ymir owns vs. what each consumer app owns. First consumers: the garden/landscape app (existing data model and real data waiting to migrate) and the home/interior tool (design + the maintenance/asset system, which will attach maintenance records to Ymir features). Define the contract so consumers never fork spatial truth.
6. **Storage and API shape:** local-first persistence, how consumers read/write (library, service, or both), multi-property support, and export/backup.
7. **Migration path:** how the existing garden spatial model and its pending real data land in Ymir without loss.

## Designed-for-later (accommodate, do not design fully)

Visualization layers (2D plans, eventual 3D), photo/scan-assisted capture, the maintenance system's deep integration, outdoor↔indoor environmental modeling (light, water, climate), and multi-user household access.

## Constraints

- Standalone repo; platform-neutral core; consumers may live on either machine.
- Bifrost design system reference is at `docs/reference/` — this session designs no UI, but any eventual UI is Bifrost-bound; keep the constraint set in view.
- Every open question, trade-off, or judgment call goes into an explicit "rulings needed" list for review — this session's output is reviewed before anything builds.
