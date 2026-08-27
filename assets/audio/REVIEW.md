# Audio review — sign-off batch

Per `DESIGN-DECISIONS.md` → *Asset approval*, only the music, the UI sounds and the
headline models need sign-off. This is the audio half of that: **every music track, every
radio station and every OS startup chime**, with one line on what it is and why it fits.

Everything here is **CC0 / public domain** — full provenance in `/CREDITS.md`.

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

The four tiers must read as four different fictional operating systems, not four takes on
one. They are deliberately from **four different sound families**, and the ladder goes
*raw oscillator → chip fanfare → sampled mallet → sustained ensemble* — the real history of
computer startup sounds in miniature. I verified the character difference on spectrograms
before choosing: tier 1 is a bare fundamental with almost no harmonics, tier 2 is dense
square-wave harmonic ladders, tier 3 is percussive transients with short decay, tier 4 adds
a sustained rich tail no earlier tier has.

| Path | Length | Chime | Reads as |
|---|---|---|---|
| `os/boot-tier1` | 1.04 s | *lowThreeTone* — Kenney (Digital Audio) | **Pentagram 133.** Three low bare tones, essentially a PC speaker — nearly no harmonic content. The most primitive rung: it sounds like a machine confirming it has power, not welcoming you. |
| `os/boot-tier2` | 1.76 s | *jingles_NES00* — Kenney (Music Jingles, 8-Bit) | **Kompakt 2000.** A proper 8-bit chip fanfare — same synthetic family, but now it's a *tune*. The generation that decided booting should feel like an event. |
| `os/boot-tier3` | 1.55 s | *jingles_STEEL07* — Kenney (Music Jingles, Steel) | **Sunstation Pro.** Sampled mallet/steel chime — the jump from oscillators to recorded instruments, which is exactly the real-world 90s transition. Clean, professional, a bit corporate. |
| `os/boot-tier4` | 1.74 s | *jingles_SAX07* — Kenney (Music Jingles, Sax) | **Melon Studio M5.** A lush sustained sax chord with a long rich tail. Unmistakably the most expensive machine in the room, and slightly pleased with itself — which is the joke the parody names are already making. |

---

## Notes for whoever wires this up

- Logical ids are what the game calls: `ui.click`, `sfx.coffee-machine`, `os.boot.1`,
  `music.menu`, `radio.1`, `amb.office-room-tone`. Full list in `manifest.json`.
- Manifest paths are relative to `assets/audio/`, which matches `AudioBus.basePath`
  in `src/core/audio.js`.
- Ship **both** formats: `.ogg` (Vorbis q4) for everything, `.m4a` (AAC) because Safari
  on iOS — a stated target — does not decode Vorbis.
- `gain` in the manifest is a per-kind mix trim on top of the bus gains, not a
  normalisation factor; the files are already loudness-matched
  (music/ambience/radio ≈ −16 LUFS, sfx/UI ≈ −14 dBFS peak-window RMS, all peak-limited
  below −1 dBFS so nothing clips).
- Every `loop: true` file is a genuine seamless loop: cut at a rising zero crossing and
  wrap-crossfaded, then normalised with a **constant** gain so the seam survives. Measured
  wrap discontinuity is between 0.2 % and 51 % of the file's own largest ordinary
  sample-to-sample step — i.e. the loop point is within the signal's normal motion.
