# Smendiłendi Bureau — locked design decisions

Closed in a `/pytania` session on 2026-08-27. These are the player's (Jurek's)
decisions. Everything NOT listed here is the agent's call.

Made as a gift for Jurek's dad, a practising architect at an R&D studio. He is the
target player: it must be simple to pick up but never insultingly shallow — a real
architect should feel the game knows what it is talking about.

## Core loop
1. Brief arrives by in-game e-mail: client, building type, budget, plot, required program.
2. Player walks to their desk, sits, clicks the monitor, designs in the in-game 3D editor.
3. Submit → screen wipe ("3 days later") → reply e-mail with the list of things to fix.
4. **Exactly one revision round.** Fix, resubmit, done.
5. Client accepts → "30 years later" transition → all players walk the finished building
   together in first person while simulated people live in it.
6. Back to the office, next commission.

## Editor scope
- Player draws **walls** on a grid (line tool, auto thickness, auto floor/ceiling),
  cuts in doors and windows, then furnishes from the catalogue. Building shell is
  the player's, not pre-made.
- View: orbiting 3D by default (SketchUp-like), hotkey to orthographic top-down for
  precise wall drawing, hotkey to eye-level walkthrough preview.
- Free scaling on any axis, free rotation, materials on surfaces, colour on furniture,
  3D text as a placeable object (shop signs, house numbers, facade lettering).
- Catalogue: ~80 components, **all authored in Blender** via parametric scripts that
  generate whole families (one "chairs" script → many variants), plus a handful of
  hero pieces modelled by hand. Every component has real metric dimensions and a price.

## Evaluation — no AI, a real analysis engine
The revision e-mail is generated from deterministic measurements of the actual model.
All four modules are required:
- **Access & circulation** — navmesh from the model: is every room reachable from the
  entrance, rooms without doors, bathrooms only reachable through a bedroom, minimum
  clear widths (wheelchair/pram), a valid escape route.
- **Daylight** — window-to-floor area ratio per room, plus ray sampling from the sun at
  several times of day against the plot's neighbouring buildings. Produces "this room
  is too dark" with a number.
- **Budget & cost** — per-component prices, walls and floors costed by area, live
  cost-vs-budget bar, overrun is a hard client complaint.
- **Program & ergonomics** — are all required rooms present at the required area; can
  furniture actually be used (wardrobe doors that cannot open, a bed blocking the
  circulation, a too-narrow kitchen run); do doors have room to swing.

## Commissions
- **Procedurally generated**, drawing on 6–8 building types, each with its own program
  and its own rules: detached house, café/restaurant, kindergarten, office (max 4
  floors), clinic, library, small shop, small apartment building.
- Every commission generates a **real plot**: shape, boundaries that must not be
  crossed, neighbouring buildings that cast shade, a street side the entrance must
  face, trees, possibly a slope.
- Soft deadline: missing it costs part of the fee and reputation, never blocks finishing.

## Multiplayer
- 1–3 players, one shared office. Session-only, joined by an office code, no accounts.
- **One shared model, everybody can edit everything**, Figma-style. Conflicts handled by
  a **grab lock**: whoever grabs an object holds it, it glows in that player's colour and
  is frozen for the others until released. Live coloured cursors and selections.
- The brief still contains an assignment table (floors/wings/zones) as guidance.
- Text chat only, no voice.
- One workstation per player. Each desk has a nameplate with the player's nick in 3D text.

## Office & progression (within the session, nothing persists)
- One shared bank. Fees fund everything.
- **Hireable employees** at three tiers: intern (cheap, makes mistakes you must fix),
  architect (solid), partner (excellent, expensive). A hired employee gets their own
  cubicle with a nameplate and actually designs their assigned scope.
- **Four computer tiers**, parody names (e.g. Pentagram 133 → Kompakt 2000 → Sunstation
  Pro → Melon Studio M5). The starter machine is a PSX-era box: small grainy screen,
  chunky cursor, slow previews, short undo history. Upgrades give a bigger sharper
  screen, smoother camera, longer undo, live daylight preview — and a new OS theme,
  cursor and startup sound each time.
- Desks, chairs, lighting and plants upgrade on a separate track from the computers.
- Desk personalisation (plant, poster, figurine, mug colour) visible to other players.

## The in-game computer
- Fictional retro OS with a desktop, draggable titled windows, a clock, a startup sound.
- Apps: the 3D editor, Mail (briefs and client feedback), team Chat, Cost sheet (live).
- Hovering the monitor in the world draws a white outline; clicking flies the camera to
  the screen, frees the mouse and hands control to a custom in-OS cursor. Escape pulls back.

## Office interaction (first person, WASD, pointer lock)
Coffee machine → carry a mug → sip for a focus boost (mug cools, can be set down);
sitting down at the desk; desk personalisation; and ambient life — a lamp to switch on,
blinds to raise, a radio, a bin to throw paper at, a corkboard with the brief.

## "30 years later"
10–30 NPCs with roles suited to the building type and real daily goals (bathroom, coffee,
desk, classroom), pathfinding through the player's actual layout. An NPC with no route
stops and visibly gets annoyed. Over the walk: client verdict, cost, usage stats and a
movement heatmap. Then back to the office.

## Main menu
A living 3D scene built around a **deliberately badly designed building** — the menu
buttons are the 3D lettering on that building (Single Player, Multiplayer, Settings,
Credits), changing colour on hover. Nick and player colour are chosen here.
Game title in 3D as part of the scene.

## Look
Clean low poly: simple volumes, softly bevelled edges, a limited warm palette, flat
colours on furniture (no textures on props), soft lighting with ambient occlusion.
Materials (plaster, brick, wood, concrete, tile, grass, paving) exist as a paint palette
for walls, floors, ceilings and facades, and they affect cost.

## Audio
Everything sourced from the internet, CC0 only, licences recorded in a CREDITS file.
Quiet unobtrusive ambient while designing, separate menu and walkthrough themes, plus a
switchable office radio with spatial falloff. Needed at minimum: keyboard, mouse clicks,
retro startup, coffee machine, office ambience, mail notification, crowd for the walkthrough.

## Language
The game is **English only**. Metric units throughout.

## Tech
three.js, ES modules from CDN, **no build step**. Firebase RTDB for the shared session
(account gzowotesla@gmail.com, Spark plan, no billing — so no anonymous auth: access is
by a long office code, identity is a random id in localStorage). Deployed to GitHub Pages
at smendilendi-bureau.gzowo.fun. Display title keeps the Polish ł: "Smendiłendi Bureau".
No physics engine. Target: 60 fps in the office and 40 fps in the walkthrough on a
MacBook Pro 2019, furniture instanced, NPC count capped.

## Asset approval
Only key assets need sign-off: the music, the UI sounds and 10–15 headline models.
Present them on a local review page (turntable renders / play buttons, source and licence)
in batches; everything else follows the agreed style automatically.
