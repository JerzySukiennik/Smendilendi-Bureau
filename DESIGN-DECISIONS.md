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

## Jurek's second playtest — 2026-09-04. All of it binding.

Fourteen things, in his words (translated), with his priority: **multiplayer first**.
One agent builds the avatars; everything else is done by hand, in order.

1. **Multiplayer does not work.** The most important item. Two players in one office,
   joined by code, must see each other, edit the same model, chat. Fix it and prove it
   with two real browser tabs.
2. **Choose your avatar.** Before the game starts the player picks and customises an
   avatar; it must look like a person — clothing that moves as they walk (baggy
   tracksuit trousers, not jeans, was his example), a nick above the head in a nice
   typeface, and real walking, sitting and typing animations. Players see each other's.
3. **Remove the dev things.** The numbered dots the critics put on the menu building go.
   The FPS/debug panel goes — he plays on his faster machine (80-144 fps) and does not
   want it on screen.
4. **The editor opens INSIDE the in-game computer.** Not a separate window over the
   game: clicking the monitor zooms the camera until the monitor fills the real screen,
   and the editor runs on that screen — no top bar, or only a small one with a close
   button. The screen resolution is the computer tier's, so upgrading the machine is
   worth it because you see more. (This is the contract's original intent; it is being
   restated because the built thing did not do it.)
5. **A real Wall tool.** Room makes rooms; there is no way to draw a single wall at an
   angle from one wall end to another. Wall: click two points, get a wall of the
   standard thickness, same as a room's walls.
6. **Doors placed in build mode count.** A door put in through the build tools must
   satisfy the client's requirement for a door; today it does not register.
7. **The Door tool (D) must place a DOOR, not cut a hole.** Frame, leaf, swing.
8. **The "what is still missing" panel does not update live.** It lists things already
   fixed. It must follow the model in real time.
9. **The plot is not real yet.** He can still build outside the grey area; trees still
   sometimes appear inside it; the trees are undetailed and so is the grass; the site
   wants more atmosphere and effects generally. Building outside the grey area must be
   physically impossible, not merely warned about.
10. **Mail layout.** Too little room for the message, too much for the client list.
11. **A dead cursor is left behind** from the in-game computer when the editor opens.
12. **Two cursors after an upgrade.** The old, smaller cursor sits under the new one and
    stays behind when the pointer leaves a window.
13. **The coffee machine.** Today: click, mug appears in hand, nothing pours. It should
    be: take a mug from the shelf to the right of the machine, set it under the spout,
    coffee pours (particles), then carry it, put it down, throw it, spill it. The mug
    handle is a blocky mess and needs modelling properly.
14. **Throwing paper.** Today E throws the ball in a fixed direction so you cannot hit
    the bin. It should be: E picks the paper up, you aim at the bin, left click throws.

Two of his own directions to hold onto while doing these: make it genuinely nice, and
keep the retro OS untouched.

## Interface — added 2026-09-04, same playtest

15. **Highlight the SHAPE, not a box.** Interactive things (the monitor, the coffee
    machine, the bin, the radio, the blinds, the lamp) currently get a rectangle. The
    outline must follow the model's own silhouette, and it must be **thicker** — legible
    across the room, not a hairline.
16. **Prompts belong under the crosshair.** "Press F to…" sits in the bottom-left
    corner, away from where the player is looking. Put it centred, just below the
    cursor dot, where the eye already is.
17. **The whole interface needs lifting, and the EDITOR MOST OF ALL.** Jurek: "it is
    terrible that you cannot get your bearings in it at all." That is the priority of
    this item — the designer's UI is the thing he cannot read. Tool palette, what is
    armed, what a tool wants next, dimensions, the room schedule, cost, and the way out:
    all of it has to be findable without being told.

## The four machines span thirty years — amended 2026-08-30

All four tiers currently sit in the 1990s: TRESTLE 3.1, CORNICE 98, VELLUM 8 and
ATELIER 9 are a grubby 16-colour box, a gradient-title descendant, Platinum and a
polished 1997 machine. Jurek: "Melon Studio M5 should be at the macOS 26 level and
Sunstation Pro should be Windows 11 — not that old."

He is right, and it matches the original brief rather than bending it: the stated bar is
"Windows 95/98 and early Mac OS — the bar for the fictional OS **on the starter
computer**". Retro was always about the machine you begin with. Climbing from 1996 to
today is a far better progression than four shades of the same decade, and it makes each
upgrade legible at a glance.

    tier 1  Pentagram 133    TRESTLE 3.1   640x480     Windows 95 era. UNCHANGED —
                                                       this is the one the bar governs,
                                                       and it currently scores 20/20.
    tier 2  Kompakt 2000     CORNICE 98    800x600     Windows 98 / early XP era.
                                                       Keep roughly as is.
    tier 3  Sunstation Pro   VELLUM 8      1440x900    NOW MODERN — a Windows 11
                                                       analogue: rounded corners, a
                                                       centred taskbar, mica/acrylic
                                                       translucency, Segoe-like UI, snap
                                                       layouts, a light grey-blue palette.
    tier 4  Melon Studio M5  ATELIER 9     1710x1112   NOW MODERN — a macOS 26 analogue:
                                                       a dock with rounded app tiles, a
                                                       translucent menu bar, deep corner
                                                       radii, vibrancy, SF-like UI, a
                                                       traffic-light window control set.

**What this means for the retro work already done: keep it.** Tier 1 is the graded piece
and it stays exactly as it is. Nothing about the pixel-measured Windows 95 chrome, the
traced Chicago and Geneva glyphs, the 1-bit cursors or the 16-colour palette is wasted —
it is the identity of the starter machine and the thing the brief actually asked for.

**The standing check exists: `OSDEV.retroGuard()` on `src/os/dev.html`.** It paints the
tier-1 desktop, counts distinct colours, and fails if there are more than 20 or if any
is outside VGA-16 + `#DFDFDF` + `#FFFFE1`. The tiers 3-4 critic runs it after every
change to the shared drawing surface and treats a fail as a blocker.

**And the rule that made tier 1 good still applies upward.** The reason the retro OS works
is that it was measured against real screenshots rather than remembered. Tiers 3 and 4 get
the same treatment against modern references: pull real Windows 11 and current macOS
screenshots into `reference/modern-os/`, measure the corner radii, the title bar heights,
the dock geometry, the blur radius and the palette, and hold the output against them.
"Modern-looking" by vibe is exactly the failure the original bar was written to prevent —
in both directions.

The four startup sounds already reflect this: tier 1 is Windows XP, tier 4 is macOS Big
Sur (Jurek's own choices, see CREDITS "Third-party proprietary audio"). The visuals should
have followed them and did not.

## Performance — the stall Jurek reported, 2026-08-30

In his words: "it lags horribly. Normally it's fine, about 30 fps, that's survivable, but
every so often there's a massive lag spike where I can't walk at all for about 5 seconds."

Two things to fix, and they are different problems:

  * **The baseline is 30 fps against a 60 fps target.** DESIGN-DECISIONS.md asks for 60 in
    the office and 40 in the walkthrough on a MacBook Pro 2019.
  * **A periodic multi-second stall.** Five seconds of frozen input at intervals is not
    a frame-rate problem, it is something synchronous blocking the main thread.

**Already ruled out, so do not spend time on them again:**
  * The office screen audit (`office.js:_auditScreens`) — runs twice per session on a
    9 s delay, not periodically.
  * Shadow map rebuilds — the engine sets `renderer.shadowMap.autoUpdate = true`, but the
    office disables it per-light (`rig.key.shadow.autoUpdate = false`, `office.js:875`)
    and drives it through `invalidateShadows()`. That is coherent, not a per-frame bake.

**Method — measure, do not guess.** Do NOT read the fps from the debug overlay: the
Browser pane throttles rAF and the number lies (see ARCHITECTURE.md). Instrument instead:
record every frame over 120 ms together with `renderer.info` deltas (geometries, textures,
programs) and JS heap, and register a `PerformanceObserver` for `longtask`. Then walk
around the office for a minute and read what coincided with each stall. The candidates
worth checking once you have the trace: shader compilation when a material first becomes
visible, GLB decode on the main thread, garbage collection from per-frame allocation, a
full geometry rebuild, and texture upload of the OS canvas to the GPU.

Report the ms-per-render measured with the explicit `gl.finish()` loop, the stall trace,
and the attributed cause — not a plausible story.

## The plot in the editor — amended 2026-08-30

Jurek: the editor should show a grey square where you are allowed to build; sometimes
there are trees inside that square; and the plots are laid out oddly and very similarly
to one another. All three are real, and two of them are measured.

### The buildable area must always be visible, and it is where you may build

Entering the editor, the ground shows the plot boundary and, inside it, the **buildable
area after setbacks, as a clearly readable grey footprint**. It is on by default, it does
not need to be switched on, and it reads at a glance: this is where the building goes.
Dragging a room outside it is refused, or at minimum flagged the instant it happens — not
three days later in the client's letter.

### Protected trees must never stand in the buildable area

Measured over 24 generated commissions: **19 of 24 had a protected tree inside the
buildable footprint.** That is not an awkward edge case, it is the normal outcome, and it
means the player is routinely handed a site he cannot legally build on without being told.
A critic found the cause on 2026-08-27 and the fix never landed (the agent hit a session
limit): `plot.js` sizes the plot for the footprint first, then scatters protected trees —
preferentially where they block building — and nothing re-checks that the building still
fits. Place protected trees only OUTSIDE the buildable area, or shrink/move the buildable
area to clear them, and assert it: no commission may be emitted with a protected tree
overlapping the ground the player is told to build on.

### Plots must actually differ from one another

Measured over the same 24: **20 of 24 boundaries were plain quadrilaterals** (2 pentagons,
2 hexagons). Areas vary well (640-2671 m2, 24 distinct values) but shape barely does,
which is why they read as "very similar". The earlier text promised "rectangular, corner,
deep-and-narrow, L-shaped, sloping" and the generator is not delivering it. Aim for
roughly even representation across those families, and verify by generating 24 and
counting the shapes rather than by inspection.

## Drawing a building — amended 2026-08-30, supersedes "Editor scope" where they conflict

Jurek played it and could not build anything. Two decisions, his:

### Dragging out a room is the primary way to build. The floor plan is for experts.

The editor currently expects the player to draw walls line by line, and effectively to do
it in the orthographic floor-plan view. That is backwards for this game. **Everything must
be doable without ever opening the plan view**, and the plan becomes an advanced tool the
player can reach for, not the way in.

The primary verb is: **press and drag on the ground, and a room appears.** Drag out a
rectangle, release, and you get a floor, four walls at the right thickness, and a ceiling
— sized to what was dragged, scaling live in the direction of the drag. It reads its own
dimensions as you go. Drag a second rectangle against the first and they join: shared
walls merge rather than doubling up.

This is the model a thirteen-year-old already knows from The Sims, and it is also how an
architect blocks out a plan before drawing it properly. It costs nothing in credibility —
the walls it produces are the same walls the line tool produces, the same BuildingModel,
the same analysis. Only the way in is different.

Three findings from reading the editor, which the implementing agent should start from:

  * **The editor opens with the `select` tool active** (`editor.js:131`,
    `this.setTool('select')`). Nothing is armed for drawing, so a first click does
    nothing at all — which is almost certainly why Jurek reported that he "couldn't draw
    those lines, or anything". The editor must open with the room tool armed and say so.
  * **A Rectangle tool already exists** (`tools/draw.js:207`, id `rect`). Drag-out-a-room
    is therefore mostly a matter of promoting it to the default and making one drag
    produce floor, walls and ceiling together, rather than writing a tool from scratch.
  * **`R` is currently bound to Rectangle** (`editor.js:1100`, `KeyR: 'rect'`), which
    collides with Jurek's request that R be rotate-by-a-fixed-step. **R becomes rotate**,
    as he asked; the room tool takes another key.

The wall/line tool stays for anyone who wants it, but it is no longer the default and no
longer the only route. The orthographic plan view stays, unchanged, behind an "advanced"
affordance. Nothing in the game may *require* the plan view to complete a commission.

### No chairs at the workstations.

Remove them. Walking to your desk currently means climbing onto the chair first and then
into the computer, which is clumsy and strange. The player should walk straight up to the
desk and click the monitor. Other furniture stays; it is specifically the chair tucked at
each workstation that goes.

## Difficulty — amended 2026-08-30, and this supersedes what conflicts with it

Jurek played it and the verdict was that the game is too demanding. Two decisions,
his, and they override the earlier text wherever the two disagree:

1. **The whole game gets simpler.** Fewer requirements, fewer numbers on screen, a
   gentler analysis. Where this pulls against "a practising architect must never catch
   the game being wrong", the simpler game wins. He understands the trade and made it.
2. **No area minimums shown to the player, anywhere.** A brief must never say
   "Living room >= 26 m2". It says "a big living room, one the whole family fits into"
   and the game decides for itself whether what was drawn is big enough.

**How to implement 2 without throwing away the credibility.** Keep the real numbers in
the engine, delete them from the interface. The analysis may still measure 26 m2 under
the hood; the client just never quotes it. So the e-mail says "the living room feels
cramped for the family you described" rather than "22.4 m2 against 26 m2 required".
That satisfies Jurek's instruction and still means his father cannot catch the game
being *wrong* — only that it is being polite about the arithmetic. Numbers stay
available in one optional place (the Cost sheet), never pushed at the player.

Concretely, and binding on every agent:
  * A commission asks for **3-5 rooms**, not 10. Cut the programme generator down.
  * Programme entries lose `minArea` from all player-facing text; the engine keeps it.
  * The revision e-mail leads with what to *do*, not what was measured. At most one
    number per e-mail, and only when the number is the point (a budget overrun).
  * Severity drops: fewer blockers, more "if you can". One revision round still.
  * **Acceptance = no blockers AND score >= 50.** Leniency needs a floor: with
    "blockers alone" a 0/100 house with thirteen majors was being signed off. Under
    the floor the drawings come back once, with the three biggest points in plain
    words; over it they are signed, majors and all, and the fee settlement docks 3 %
    per major rather than sending them back.
  * Plain words over jargon everywhere: "way through" not "circulation", "daylight"
    not "window-to-floor ratio".

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
(**its own dedicated Firebase project**, `bureau-gzowo-40531`, on the account
**jerzysukiennik203@gmail.com**, created and managed through the Firebase CLI; Spark
plan, no billing — so no anonymous auth: access is by a long office code, identity is a
random id in localStorage). Deployed to **GitHub Pages** at **bureau.gzowo.fun** — the `*.gzowo.fun` wildcard
already resolves to `jerzysukiennik.github.io`, so the subdomain needs no new DNS record,
only a `CNAME` file in the repo. (Firebase Hosting is configured too, but purely as a
throwaway staging mirror; production is Pages.)
Display title keeps the Polish ł: "Smendiłendi Bureau".

*Amended 2026-08-30 by Jurek: the domain shortens to bureau.gzowo.fun and the backend
moves off the shared `gzowos-games` project under gzowotesla@gmail.com onto its own.
Hosting stays on GitHub Pages as originally planned. The consequence is worth stating, because it removes a standing
hazard: a dedicated project means our database rules are no longer one instance-wide
ruleset shared with SatisFarm, Ducks, Voidworks and the rest, so deploying them can no
longer silently delete another game's rules. `firebase deploy --only database` is safe
here in a way it never was on the shared instance.*
No physics engine. Target: 60 fps in the office and 40 fps in the walkthrough on a
MacBook Pro 2019, furniture instanced, NPC count capped.

## Asset approval
Only key assets need sign-off: the music, the UI sounds and 10–15 headline models.
Present them on a local review page (turntable renders / play buttons, source and licence)
in batches; everything else follows the agreed style automatically.

## Interface — item 17, the editor (2026-09-05)

Two things the critic left standing after the palette was labelled.

**The drawing is as sharp as the machine, and only as sharp as the machine.**
The editor's render target used to be the OS texture's own size and was then
blown up to whatever the monitor covered on the real screen: measured at
806×480 shown at 1509×900, a 1.87× upscale, sitting under a DOM HUD drawn at
full crispness. The palette was razor sharp and the building behind it was
mush, and upgrading the computer changed nothing about it — which is the one
thing item 4 says the upgrade is for. The target is now sized from what it
will actually cover, scaled by the tier's own `viewportScale` grant that the
Settings app already shows the player. Measured, at a 1600×900 canvas:

| machine | render target | pixels | filter |
|---|---|---|---|
| Pentagram 133 | 831 × 495 | 0.41 MP | NEAREST |
| Kompakt 2000 | 1086 × 648 | 0.70 MP | NEAREST |
| Sunstation Pro | 1925 × 1148 | 2.21 MP | linear |
| Melon Studio M5 | 2266 × 1350 | 3.06 MP | linear |

The two retro machines stay deliberately coarse and are filtered NEAREST, so
they read as a period screen rather than a blurred one. The two modern ones
are supersampled against the 1509×900 the monitor covers. The device pixel
ratio is capped at 1.5, not taken as given: at 2× the top machine renders 4.3 MP
every frame, and we have been told once already that we were eating the CPU.

**A refusal belongs on the ghost, not on the receipt.** Dragging a room off the
plot was already refused, but the only sign of it was a line at the bottom of
the screen *on release* — the player watched an ordinary-looking ghost, let go,
and got nothing. The ghost now turns red while the pointer is off the client's
land and the ScreenTip beside the cursor reads "Off the plot", both live, both
where he is looking, both undone by moving the mouse back. The tools this
applies to are exactly the ones `_opAllowed` can refuse (wall, rectangle, room,
move); Orbit, Paint and the tape measure are free to hover anywhere. Those two
sets must be kept together — a ghost that goes red and is then accepted, or
stays orange and is then refused, is worse than no colour at all.
