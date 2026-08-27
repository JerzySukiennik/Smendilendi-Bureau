# Smendiłendi Bureau — architecture contract

**Authored by the orchestrator. Binding on every agent.**
`DESIGN-DECISIONS.md` is the product contract (what). This file is the technical
contract (how the pieces fit). If they conflict, `DESIGN-DECISIONS.md` wins.

## Hard rules

1. **No build step.** `index.html` declares an import map; everything is native ESM.
   three.js pinned at `0.180.0` from `https://unpkg.com/three@0.180.0/...`.
   Addons via `three/addons/...` mapped to `.../examples/jsm/`.
2. **No physics engine.** Collision is AABB/capsule-vs-wall-segment, written by us.
3. **English only** in game text, UI, code, comments, commits. Metric units.
4. **View-free core.** Everything in `src/model/`, `src/analysis/`, `src/commission/`
   must import **nothing** browser-only and **nothing** from `three/addons`. Only
   `three` math classes (`Vector2/3`, `Box3`, `Matrix4`) are allowed. Standing check:
   `node --input-type=module -e "import('./src/analysis/index.js')"` must resolve.
   (Use the `three` npm package in `node_modules` for the node check only; the browser
   uses the CDN. `node_modules` is gitignored.)
5. **Draw calls are the budget.** Any repeated prop goes through
   `src/core/instancing.js` (`place(name, matrix)` … `flush()`). Never `clone()` in a
   loop. `renderer.info.render.calls` is on the debug overlay from day one.
6. **Measure, never assume geometry.** `Box3.setFromObject` at runtime for any loaded
   GLB. Catalogue entries declare their metric size; the loader compares and warns on
   drift > 2 %.
7. **One source of truth for the building.** Mesh, collision, navmesh, cost and
   daylight all derive from `BuildingModel`. Never author a second copy.
8. **File ownership.** An agent edits only the files it was assigned. Cross-module
   needs go through the interfaces below — if an interface is missing, add it to your
   own file and note it in the handoff, do not edit someone else's file.

## Runtime shape

`index.html` → `src/main.js` boots `App`, which owns:

- `Engine` (`src/core/engine.js`) — one `WebGLRenderer`, one animation loop, adaptive
  pixel ratio (see below), a stack of **Modes**.
- **Modes** — exactly one active at a time, each owns its own `THREE.Scene` and camera:
  `MenuMode`, `OfficeMode`, `EditorMode`, `WalkthroughMode`.
  Interface: `{ id, init(ctx), enter(params), update(dt), render(renderer), exit(), dispose() }`.
  `ctx` = `{ engine, state, input, audio, net, assets }`.
- `State` (`src/core/state.js`) — plain observable store, the whole session:
  `{ session, players, office, bank, commission, model, analysis, mail, chat }`.
  `state.on(path, fn)`, `state.set(path, value)`, `state.patch(obj)`.
  **Every mutation of `state.model` goes through `applyOp` (see Net).**

### Adaptive quality (from prior measurement, non-negotiable)

`powerPreference: 'high-performance'`; start `setPixelRatio(min(dpr, 1.75))`; rolling
2 s average frame time; > 22 ms → step −0.25 (floor 1.0); ≤ 17 ms → step +0.25
(ceiling min(dpr,1.75)); 6 s cooldown between steps.

## The building model (`src/model/building.js`)

Pure data + pure functions. Serialisable to JSON, diffable, syncable.

```js
BuildingModel = {
  id, version,                    // version bumps on every applied op
  levels: [ { id, name, elevation, height } ],   // metres; height = floor-to-ceiling
  nodes: { [id]: { id, x, z } },                 // wall graph vertices, metres, level-agnostic
  walls: { [id]: {
      id, levelId, a: nodeId, b: nodeId,
      thickness,                                  // m, default 0.24 exterior / 0.12 interior
      type: 'exterior'|'interior'|'party',
      matInner, matOuter,                         // material ids
      openings: [ openingId ]
  } },
  openings: { [id]: {
      id, wallId, kind: 'door'|'window'|'opening',
      catalogId,                                  // door/window family from catalogue
      offset,                                     // m along wall from node a to opening CENTRE
      width, height, sill,                        // m; sill = 0 for doors
      swing: 'in-left'|'in-right'|'out-left'|'out-right'|null,
      glazingRatio                                // fraction of the hole that is glass
  } },
  slabs: { [id]: { id, levelId, polygon: [[x,z]...], kind:'floor'|'roof', mat } },
  rooms: { [id]: {                                 // DERIVED — recomputed, never hand-edited
      id, levelId, polygon, area, perimeter, name, program, doors:[openingId], windows:[openingId]
  } },
  furniture: { [id]: {
      id, levelId, catalogId, x, z, y, rot,        // rot = radians about +Y
      sx, sy, sz,                                  // free scale per axis, default 1
      color,                                       // hex or null = catalogue default
      lockedBy                                     // playerId | null  (grab lock)
  } },
  texts: { [id]: { id, levelId, value, font, x, y, z, rot, size, depth, color, faceNormal } },
  siteMods: { ... }                                 // terrain/paving edits, phase 2
}
```

Derived, cached, invalidated by `version`. **As built** (`tools/smoke.mjs` exercises
every one of these end to end):

```js
// src/model/rooms.js — planar-subdivision face finding over the wall graph
computeRooms(model, levelId) → { rooms: {id: Room}, order: [id], edges: [Edge], levelId }
getRooms(model, levelId)      // the same, memoised on model.version
Room = { id, levelId, polygon, holes, area, perimeter, name, program,
         doors:[openingId], windows:[openingId], wallIds, isOutside, undersized }
Edge = { a: roomId|'OUTSIDE', b: roomId|'OUTSIDE', openingId, clearWidth }
roomGraph(model, rooms) → { nodes: [roomId|'OUTSIDE'], edges: [Edge] }
roomCentroid(room) → { x, z }   // never lands outside an L-shaped room

// src/model/geometry.js
buildMeshes(model, opts) → { group, colliders, byId, stats, bounds, diagnostics, materials }
disposeBuilt(built)
```
`area` is the **clear internal area**: the face polygon runs along wall centrelines
and each edge is then offset inward by half of *its own* wall thickness. A 6.00 ×
4.00 m room in 0.24 m walls is 21.66 m², which is the number on the drawing.
Room ids are a hash of the sorted wall ids of the face, so they survive edits
elsewhere in the plan. Openings are **gaps in the wall extrusion**, never CSG.

### Ops (the only way to change the model)

```js
Op = { t: 'wall.add'|'wall.move'|'wall.delete'|'opening.add'|... , ...payload, by: playerId, seq }
applyOp(model, op)   → { model, changed[], inverse }   // pure; the input is never mutated
applyOps(model, ops) → { model, inverses[] }
rectOps(x0, z0, x1, z1, opts) → Op[]                   // a closed rectangle of walls
serialize(model) / deserialize(json)
```
`wall.add` splits itself and every wall it crosses at the crossing points, and splits
any wall passing through its own endpoints — that is what makes closed regions, and
therefore rooms, appear without a separate "make room" step.

Room names and programmes are NOT wall data: they live in
`model.siteMods.roomNames[roomId]` and `model.siteMods.roomPrograms[roomId]`, written
by the `room.rename` / `room.setProgram` ops and read by `classifyRooms`.

Undo = inverse op recorded at apply time. Multiplayer = ops broadcast over RTDB.
This makes local undo, network sync and employee bots the same mechanism.

## Catalogue (`src/model/catalog.js` + `assets/models/*.glb`)

```js
CatalogEntry = {
  id, name, category,           // seating|tables|storage|beds|sanitary|kitchen|doors|windows|lighting|plants|office|retail|misc
  file,                         // assets/models/<file>.glb, or null for procedural
  size: [w, h, d],              // metres, real, verified against the GLB bbox at load
  price,                        // PLN-free abstract currency units, integer
  anchor: 'floor'|'wall'|'ceiling',
  mount,                        // m above floor for a wall/ceiling item
  clearance: { front, back, left, right, zMin, zMax },
                                // m of usable space required, over a band of
                                // heights — a wall cabinet is not in the way of
                                // the worktop 0.55 m below it
  tags: [ 'seat', 'workstation', ... ],
  colorable: true|false,        // which material slot takes the tint
}
```
Every entry's numbers must be defensible to an architect. A worktop is 0.90 m, a
door leaf is 0.90 × 2.05 m, a corridor is ≥ 1.20 m, a bed needs 0.70 m down one side.

`src/analysis/catalogue.js` is the **only** file in `src/analysis/` allowed to touch
the catalogue. It normalises every entry, guesses a defensible fallback for an
unknown id, and owns the translation between the two vocabularies in the project:

```js
resolveTag(tag) → { kind: 'tag'|'id'|'text'|'unstocked'|'unknown', ... }
satisfiesTag(resolved, catalogId) → boolean
```
The commission briefs ask for a `bed_double` and a `washbasin`; the catalogue tags
those things `bed` and `basin`. Every consumer of a brief's `requires` list goes
through `resolveTag`. A requirement nothing in the catalogue can satisfy resolves to
`unstocked` and is **recorded, never complained about** — an architect is not marked
down for failing to draw an object that is not in the palette.

## Analysis (`src/analysis/`)

`runAnalysis(model, brief) → Report`

```js
Report = { score, accepted, issues: [ Issue ], metrics: {...} }
Issue = {
  module: 'access'|'daylight'|'cost'|'program',
  severity: 'blocker'|'major'|'minor',
  code,                       // stable id, e.g. 'ACCESS_ROOM_UNREACHABLE'
  roomId|wallId|furnitureId|openingId,   // what to highlight
  measured, required, unit,   // the numbers that justify the complaint
  clientText                  // the sentence that appears in the client's e-mail
}
```
`accepted` is `true` when nothing is a blocker or a major; minors go in the letter
but do not stop the client signing. `score` = 100 − 25/blocker − 10/major − 3/minor.

**Five** modules, each `analyzeX(ctx) → { issues, metrics }` with
`ctx = { model, brief, topo, classes }`:

| module | file | measures |
|---|---|---|
| access | `access.js` | entrance, reachability, clear widths, escape distance, door swings |
| daylight | `daylight.js` | window-to-floor ratio, NOAA sun rays against walls, ceilings and neighbours |
| cost | `cost.js` | a real bill of quantities, then money |
| programme | `program.js` | rooms present at area, adjacencies, furniture, ergonomic clearances |
| site | `site.js` | boundary, setbacks, storey and coverage limits, protected trees, entrance direction |

Site issues carry `module: 'program'` (planning compliance) or `'access'` (the
entrance), so the Issue interface above is unchanged.

`buildTopology(model)` merges the per-level `computeRooms` results and adds the two
things the model layer does not provide — where an opening sits in the world and the
quarter disc a door leaf sweeps:
`{ rooms, byId, openingRooms, exteriorDoors, adjacency, graphEdgeCount }`.
`classifyRooms(model, topo, brief) → Map(roomId → { key, label, habitable, glaze,
minCeiling, source, renamed, index, tags, furniture })`.

### The brief the engine reads

`brief` is a flattened commission, and `src/analysis/brief.js` is the only place that
interprets it:

```js
brief = { buildingType, title, client:{name,tone,...}, budget, program, constraints, plot }
briefLimit(brief, check, fallback)   // the number the CLIENT put in writing
requiresAccessibility(brief), isDwelling(brief), isPublicBuilding(brief), plotOf(brief)
```
**Every limit is read through `briefLimit`.** The brief says "circulation must stay at
least 1.40 m clear"; if a module then measures against its own hard-coded 1.20 m the
client contradicts himself in writing, which is the one thing a report to an architect
cannot do. The constants in each module are the fallback for a brief that is silent.

### Two width conventions (access)

* **clear width** — measured between wall faces along the route. A doorway is not part
  of it: a 1.20 m corridor served by 0.90 m leaves is a 1.20 m corridor.
* **door clear opening** — the leaf width, checked in its own right. Below
  `DOOR_MIN_CLEAR` a doorway does become the route's bottleneck, because at that point
  something really is in the way.

A door SWING is never subtracted from the walkable grid. It is measured against
furniture (`ACCESS_DOOR_SWING_BLOCKED`) and against other doors
(`ACCESS_DOOR_SWING_CLASH`), which is what the swing has to be clear of.

### The e-mail

```js
revisionMail(report, brief) | acceptanceMail(report, brief) → { subject, from, tone, body }
clientMail(report, brief)     // whichever the report deserves
```
Deterministic. No randomness, no AI. Same model in → same e-mail out, byte for byte;
`tools/smoke.mjs` asserts it by running the whole pipeline twice. The client's voice
comes from `brief.client.tone`, and `mail.js` must carry **every** tone
`src/commission/clients.js` can generate — currently eight.

## Commissions (`src/commission/`)

```js
generateCommission(seed, difficulty, history) → Commission
generateCampaign(seed, count) → Commission[]
```
Same seed + difficulty + history length → byte-identical commission. A commission
carries `{ id, type, typeName, client, title, briefText, address, budget, fee,
deadlineDays, params, storeys, areas, program, constraints, plot, reputationDelta }`.
`program` entries are `{ key, name, minArea, count, requires, adjacentTo, phrase, hero }`;
`constraints` are `{ code, check, text, limit }` and `check` is what `briefLimit` looks up.
The generator guarantees a **solvable** plot: it is sized for the coverage limit, the
planted-area limit and any outdoor requirement before it is offered.

## Net (`src/net/`)

Firebase RTDB, no auth. Office code = 8 chars from an unambiguous alphabet.
Path root: `/smendilendi/<officeCode>`.
```
/meta        { createdAt, host, phase }
/players/<pid>   { nick, color, cursor:{mode,x,y,z}, sel:[ids], lastSeen }
/ops/<seq>       Op                       // append-only, capped at 500, snapshotted
/snapshot        { model, seq }           // written by host every 50 ops
/locks/<objId>   { pid, at }              // grab lock, TTL 15 s via onDisconnect
/chat/<id>       { pid, text, at }
```
Single player runs the same code with a `LocalTransport` (no Firebase, no network).
`src/net/session.js` exposes the transport; nothing above it knows which is in use.

```js
createLocalTransport({ code, playerId, nick, color }) → LocalTransport
await transport.connect({ onOp, onSnapshot, onPlayers, onChat, onLock, onPhase, onHost })
                                         // → { isHost, code, kind }
transport.sendOp(op) | setCursor | lock | unlock | chat | writeSnapshot | leave
```
`tools/smoke.mjs` puts two players in one office, has each send an op, and asserts both
sides end up byte-identical after `applyOps`.

## Modes and who owns what

| Mode | Directory | Owns |
|---|---|---|
| Menu | `src/menu/` | 3D menu scene, badly-designed building, nick/colour |
| Office | `src/office/` | FPP walking, office room, desks, props, interaction, employees, economy |
| OS | `src/os/` | the in-game computer: window manager, themes, Mail/Chat/Cost apps |
| Editor | `src/editor/` | tools, snapping, gizmos, HUD, the three editor cameras |
| Walkthrough | `src/walk/` | 30-years-later, NPCs, pathfinding, stats |

The Editor renders into a **render target** that is the monitor's screen texture when
approached in the office, and full-screen once focused. Same code path both times.

## Look

Palette and materials live in `src/core/palette.js`. Warm limited palette, flat colours
on furniture, `MeshStandardMaterial` with `roughness` per material class, no textures on
props. Lighting: one warm key `DirectionalLight` with a tuned shadow camera, one cool
`HemisphereLight`, baked-feel AO via `SSAOPass`-free means (vertex AO on generated
geometry + a cheap contact-shadow decal under furniture). Post: none beyond an optional
mild `ACESFilmic` tone mapping.

## Progress page

`progress/index.html` (auto-refreshing) renders `progress/progress.json`. Every agent
that finishes a piece appends an entry via `tools/log-progress.mjs`. Never hand-edit
the JSON.

## The standing check

```
node tools/smoke.mjs
```
Generates a commission from a fixed seed, builds a house for it with `rectOps`/`applyOp`,
computes the rooms, builds the meshes, runs the analysis, prints the client's revision
e-mail verbatim, applies the fixes, re-runs, prints the acceptance letter, proves the
site module fires on a building shoved into the street, sweeps all eight building types,
and asserts two full runs are byte-identical. It exits non-zero on any throw or failed
assertion. Run it after touching anything under `src/model/`, `src/analysis/`,
`src/commission/` or `src/net/`.

## Definition of done for any piece

- Runs in the browser with zero console errors.
- Its numbers are architecturally defensible.
- Draw calls and frame time measured, not guessed.
- Reviewed by a critic with fresh context against the named bar.
