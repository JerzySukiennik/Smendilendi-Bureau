# Audio review — sign-off batch

Per `DESIGN-DECISIONS.md` → *Asset approval*, only the music, the UI sounds and the
headline models need sign-off. This is the audio half of that: **every music track, every
radio station and every OS startup chime**, with one line on what it is and why it fits.

Most of this is **CC0 / public domain**. Six files are **not**: the four OS startup chimes, `ui.error` and `ui.mail-notify` were supplied by the project owner on 2026-08-27 and are Microsoft / Apple system audio. Full provenance for both groups, kept apart, in `/CREDITS.md`.

**How to audition:** every entry ships as `.ogg` and `.m4a` at the path shown. Open the
folder and play them, or drop `assets/audio/` into any player. I could not listen to these
myself — selections were made from the authors' own descriptions and tags, cross-checked
against spectrograms for the startup chimes — so **your ears are the actual sign-off.**
If something is wrong, the fix is a one-line swap in `assets/audio/manifest.json`.

---

## Music (stereo, seamless loops)

| Path | Length | Track | Why it fits |
|---|---|---|---|
| `music/menu` | 58 s | *Cozy Puzzle Title* — MintoDog | Warm brass-and-flute title loop at 95 bpm. Playful but unhurried — it invites you in without promising an epic. Sits right against the deliberately badly designed menu building: cheerful, a little silly, not a joke at the player's expense. |
| `music/office-ambient-1` | 75 s | *Osmotic Memory* — Tsorthan Grove | Slow hypnotic ambient with **no melodic hook at all** — pure texture. This is the one you can design under for twenty minutes without noticing it, which is exactly the brief ("quiet unobtrusive ambient while designing"). |
| `music/office-ambient-2` | 75 s | *Qubiliu* — cinameng | The second designing track, so the office doesn't feel like one looping tape. Dreamlike lo-fi synth written as casual-game background; slightly warmer and more present than *Osmotic Memory*, good for later in a session. |
| `music/walkthrough` | 90 s | *Forget Me Not (F major, looped edit)* — Kistol | Bittersweet neoclassical piano. This is the "30 years later" walk through the building you drew — it has to be nostalgic without being sad, and restrained enough that the client verdict and the NPC life stay audible over it. The longest loop in the game because this is the emotional payoff. |

## Radio (mono, positional, spatial falloff — six stations, six genres)

The office radio is diegetic, so these are deliberately varied: turning the dial should
feel like a real dial. Mono because they fall off with distance from the radio object.

| Path | Length | Track | Genre / why |
|---|---|---|---|
| `radio/radio-1-jazz-brass` | 26.5 s | *Jazz n' brass loop* — Emma_MA | **Jazz/lounge.** Brass with a 90s swing. The default station — the one an architecture practice would actually leave on. Shortest loop, used as the author wrote it. |
| `radio/radio-2-bossa-elevator` | 58 s | *Which Brand Of Mustard Shall I Buy* — congusbongus | **Bossa / elevator.** Tracker-made shopping-centre music, deliberately banal — and knowingly so. The funniest thing on the dial and the most office-appropriate. |
| `radio/radio-3-lofi` | 68 s | *Chill lofi inspired [loop edit]* — qubodup, from omfgdude | **Lo-fi / downtempo.** The obvious modern studio station. Already an authored loop edit, so it survives being cut cleanly. |
| `radio/radio-4-funk` | 63 s | *Funked Up* — Joth | **70s funk.** Rhodes and guitar groove — the one station with energy, for when the office needs waking up. Keeps the dial from being uniformly mellow. |
| `radio/radio-5-acoustic` | 55 s | *Wooden Inn* — Indieteur | **Acoustic / folk.** Slow calm guitar, cabin feel. The quiet end of the dial. |
| `radio/radio-6-piano` | 55 s | *Juni* — Kistol | **Light classical.** Contemporary solo piano. Reads as a classical station, and gives the office a serious register when you want one. |

## OS startup chimes (mono, positional — four computer generations)

**Replaced 2026-08-27 at the project owner's direction.** He rejected all four Kenney
chimes and supplied his own files, one per tier. They are real operating-system startup
sounds, they are **not CC0**, and they are logged separately in `/CREDITS.md` under
*Third-party proprietary audio* and flagged `"proprietary": true` in `manifest.json`.

The ladder he chose is chronological, and it happens to land exactly on the parody names
the design already had: three generations of Windows, then a Mac for the endgame machine.

| Path | Length | Chime | Reads as |
|---|---|---|---|
| `os/boot-tier1` | 4.27 s | Microsoft **Windows XP** startup (2001) | **Pentagram 133.** The starter machine. Instantly dated, instantly recognisable, and — for anyone who has used it — the sound of a computer you would want to upgrade away from. |
| `os/boot-tier2` | 4.02 s | Microsoft **Windows Vista** startup (2006) | **Kompakt 2000.** Cleaner and more orchestral than XP, same idea one generation on. The source file's own ID3 tags name it: artist *Microsoft*, album *Windows*, title *Vista*. |
| `os/boot-tier3` | 2.28 s | Microsoft **Windows** startup chime, release unlabelled | **Sunstation Pro.** Supplied as a bare `w.mp3` with no title metadata. Measured: three struck bell notes, F♯3 → C♯4 → G♯4 over 0.9 s, then a 1.6 s shimmering decay. Demonstrably neither XP nor Vista (both here for comparison); structurally the Windows 7 / Windows 8-era chime. Named by measurement in CREDITS, not by guess. |
| `os/boot-tier4` | 2.83 s | Apple **macOS Big Sur** startup | **Melon Studio M5.** The Mac chord. The endgame machine, and the one joke the parody names were always making. |

## UI sounds (mono, non-positional)

Six of these were replaced on 2026-08-27 too, for two different reasons, and the
replacements answer the reasons rather than just being different files.

**"Too synthetic"** — `ui.click`, `ui.window-open`, `ui.window-close`. **"Already in too
many of my games"** — `ui.snap`, `ui.submit`, `ui.tool-select`; that set was the Kenney
interface pack, which is the single most recognisable UI pack on the internet.

So all six are now **edits of microphone recordings of real physical objects**, none of
them from Kenney, all CC0 from freesound and already licensed in this pack. A game set in
an architecture studio full of physical objects should sound like one.

| Path | Length | What it physically is | Reads as |
|---|---|---|---|
| `ui/click` | 0.057 s | A real mouse switch, press only (Pepe827) | The default confirm. In the fiction the player IS clicking a mouse on an in-game computer, so the literal sound is the right one. |
| `ui/click-soft` | 0.10 s | *tick_004* — Kenney. **Approved unchanged**, trimmed to gain 0.51 | Hover and secondary presses. |
| `ui/tool-select` | 0.119 s | One real key, down and up (chris112233) | Switching tool in the editor. A different object from the mouse, so it does not read as another click. |
| `ui/snap` | 0.113 s | A real toggle light switch (Philip_Berger) | A wall endpoint snapping to the grid. This is the one that has to be *felt* — a mechanical detent is exactly that. |
| `ui/window-open` | 0.221 s | A real door latch being pressed (JohnyTud), pitched up 14 % | A window opening in the in-game OS. Pitched up so a full-size door reads as a small drawer front. |
| `ui/window-close` | 0.181 s | The same door's latch catching, same pitch shift | The counterpart. Same object, falling instead of rising — they are one piece of hardware. |
| `ui/submit` | 0.440 s | A real sheet of paper gathered and released (Lau7) | Sending a design to the client. The drawing physically leaving the studio, which is the small ceremony the moment deserves. |
| `ui/error` | 0.846 s | **Owner-supplied**, `erro.mp3`. NOT CC0 | A refused action. |
| `ui/mail-notify` | 1.99 s | **Owner-supplied**, Microsoft Windows 10 notification. NOT CC0 | A brief or a client reply lands in Mail. |

---

## Notes for whoever wires this up

- Logical ids are what the game calls: `ui.click`, `sfx.coffee-machine`, `os.boot-tier1`,
  `music.menu`, `radio.1`, `amb.office-room-tone`. The OS chimes were `os.boot.1`…`os.boot.4`
  and are now `os.boot-tier1`…`os.boot-tier4`, so the manifest id, the file name, the
  review page and `CREDITS.md` finally all say the same thing. Full list in `manifest.json`.
- Manifest paths are relative to `assets/audio/`, which matches `AudioBus.basePath`
  in `src/core/audio.js`.
- Ship **both** formats: `.ogg` (Vorbis q4) for everything, `.m4a` (AAC) because Safari
  on iOS — a stated target — does not decode Vorbis.
- `gain` in the manifest is the asset's own level, not a normalisation factor; the files
  are already loudness-matched (music/ambience/radio ≈ −16 LUFS, the 2026-08-27 rebuilds
  to −14 LUFS, one-shots to a matched peak-window RMS, everything peak-limited so nothing
  clips at the mix).
- **What a sound actually plays at is `assets/audio/mix.json`**, not this file and not the
  manifest alone: `effective = master × buses[kindToBus[kind]] × entry.gain`. The review
  page and `src/core/audio.js` both read that one file, so they cannot disagree. Verify
  with `node assets/audio/build/verify-signoff.mjs`, which prints both columns.
- The twelve files replaced on 2026-08-27 are rebuilt by
  `assets/audio/build/build-signoff.mjs` — it is in the repo and reproduces them exactly.
- Every `loop: true` file is a genuine seamless loop: cut at a rising zero crossing and
  wrap-crossfaded, then normalised with a **constant** gain so the seam survives. Measured
  wrap discontinuity is between 0.2 % and 51 % of the file's own largest ordinary
  sample-to-sample step — i.e. the loop point is within the signal's normal motion.
