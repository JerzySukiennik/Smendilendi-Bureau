#!/usr/bin/env node
// build-signoff.mjs — rebuild every audio file changed by the 2026-08-27 sign-off.
//
//   node assets/audio/build/build-signoff.mjs
//
// Two groups, both ending as mono 44.1 kHz .ogg (Vorbis q4, via vorbis-tools —
// this ffmpeg build has no libvorbis) plus .m4a (AAC-LC).
//
//   PROPRIETARY  six files the project owner supplied himself. Microsoft / Apple
//                system audio, NOT CC0. Converted as delivered: silence trimmed,
//                levelled, limited. Flagged "proprietary": true in manifest.json
//                and listed separately in CREDITS.md.
//
//   DERIVED      six CC0 replacements for UI sounds the owner rejected as "too
//                synthetic" or "already in too many of my games". Each is an edit
//                of a RECORDED PHYSICAL object already licensed in this pack
//                (freesound CC0, none from Kenney): a real mouse switch, a real
//                toggle switch, a real key, a real door latch, real paper.
//
// Levelling. The instruction is two-pass linear loudnorm at about -14 LUFS.
// EBU R128 needs 400 ms of content to produce an integrated value, and half of
// these files are shorter than that, so:
//   * content >= 0.4 s  -> ffmpeg loudnorm two-pass, linear, I=-14, TP=-1.0
//   * content <  0.4 s  -> static gain that puts the loudest 50 ms window at
//                          -18 dBFS RMS, which is what -14 LUFS means for a
//                          transient this short, then the same limiter
// Both paths finish through alimiter at -1.0 dBTP, so nothing clips.

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const AUDIO = join(HERE, '..');
const TMP = join(HERE, '.tmp');
const DL = '/Users/jurek/Downloads';

const TARGET_I = -14;      // LUFS
const TARGET_TP = -1.0;    // dBTP, what loudnorm aims at
const SHORT_RMS = -18;     // dBFS, loudest 50 ms window, for sounds under 0.4 s
// The limiter ceiling is lower than the loudnorm target on purpose. alimiter is a
// SAMPLE-peak limiter, and both codecs overshoot on decode — an AAC of a signal
// limited to -1.0 dBFS came back at +1.03 dBFS. -2.0 dBFS of sample-peak headroom
// keeps every decoded .ogg AND .m4a in this set below 0.
const CEILING_DB = -2.0;
const LIMIT = Math.pow(10, CEILING_DB / 20);

/** @type {{out:string,src:string,trim?:[number,number],rate?:number,note:string}[]} */
const JOBS = [
  // ---- proprietary, supplied by the project owner -------------------------
  { out: 'ui/error',        src: `${DL}/erro.mp3`,                        note: 'owner-supplied error tone' },
  { out: 'ui/mail-notify',  src: `${DL}/windows-10-notification.mp3`,      note: 'Windows 10 notification' },
  { out: 'os/boot-tier1',   src: `${DL}/windows-xp-startup.mp3`,           note: 'Windows XP startup' },
  { out: 'os/boot-tier2',   src: `${DL}/windows-vista-startup.mp3`,        note: 'Windows Vista startup' },
  { out: 'os/boot-tier3',   src: `${DL}/w.mp3`,                            note: 'unlabelled Windows startup chime' },
  { out: 'os/boot-tier4',   src: `${DL}/mac-os-big-sur-startup.mp3`,       note: 'macOS Big Sur startup' },

  // ---- CC0 replacements, edited from physical recordings in this pack ------
  // window is [start, end] in the source file, seconds; rate > 1 shifts the
  // recording up in pitch and shortens it, so a full-size door reads as a small
  // drawer front.
  { out: 'ui/click',        src: 'sfx/mouse-click.ogg',     trim: [0.030, 0.090], note: 'real mouse switch, press only' },
  { out: 'ui/tool-select',  src: 'sfx/keyboard-type-3.ogg', trim: [0.008, 0.140], note: 'real key, down and up' },
  { out: 'ui/snap',         src: 'sfx/light-switch.ogg',    trim: [0.088, 0.200], note: 'real toggle switch' },
  { out: 'ui/window-open',  src: 'sfx/door-open.ogg',       trim: [0.155, 0.400], rate: 1.14, note: 'real door latch, handle press' },
  { out: 'ui/window-close', src: 'sfx/door-close.ogg',      trim: [0.665, 0.875], rate: 1.14, note: 'real door latch, catching' },
  { out: 'ui/submit',       src: 'sfx/paper-toss.ogg',      trim: [0.040, 0.480], note: 'real sheet of paper, gathered and released' },
];

// ---------------------------------------------------------------------------

const run = (cmd, args) => execFileSync(cmd, args, { maxBuffer: 1 << 28 });

/** ffmpeg writes loudnorm's JSON to stderr at INFO level, so `-v error` hides it. */
function measureStderr(file) {
  let txt;
  try {
    txt = execFileSync('/bin/sh', ['-c',
      `ffmpeg -hide_banner -nostats -i ${JSON.stringify(file)} -af loudnorm=I=${TARGET_I}:TP=${TARGET_TP}:LRA=11:print_format=json -f null - 2>&1`],
      { maxBuffer: 1 << 28 }).toString();
  } catch (e) { txt = String(e.stdout || ''); }
  const m = txt.match(/\{[^{}]*"input_i"[^{}]*\}/s);
  if (!m) throw new Error(`loudnorm produced no JSON for ${file}`);
  return JSON.parse(m[0]);
}

/** Decoded mono float samples. */
function samples(file) {
  const raw = run('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', '44100', '-f', 'f32le', '-']);
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
}

function stats(file) {
  const x = samples(file);
  let peak = 0;
  for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > peak) peak = v; }
  const W = Math.round(0.05 * 44100);
  let best = 0;
  for (let s = 0; s + W <= x.length; s += Math.round(W / 4)) {
    let acc = 0; for (let j = 0; j < W; j++) acc += x[s + j] * x[s + j];
    const r = Math.sqrt(acc / W); if (r > best) best = r;
  }
  return { seconds: x.length / 44100, peakDb: 20 * Math.log10(peak || 1e-9), rms50Db: 20 * Math.log10(best || 1e-9) };
}

mkdirSync(TMP, { recursive: true });
const report = [];

for (const job of JOBS) {
  const src = job.src.startsWith('/') ? job.src : join(AUDIO, job.src);
  if (!existsSync(src)) { console.error(`MISSING SOURCE ${src}`); process.exitCode = 1; continue; }
  const base = job.out.replace('/', '_');
  const cut = join(TMP, `${base}.cut.wav`);
  const fin = join(TMP, `${base}.final.wav`);
  const outOgg = join(AUDIO, `${job.out}.ogg`);
  const outM4a = join(AUDIO, `${job.out}.m4a`);

  // 1. mono / 44.1 kHz / optional window / optional pitch, then trim silence off
  //    both ends at -55 dBFS.
  const pre = [];
  if (job.trim) pre.push(`atrim=start=${job.trim[0]}:end=${job.trim[1]}`, 'asetpts=N/SR/TB');
  if (job.rate) pre.push(`asetrate=44100*${job.rate}`, 'aresample=44100');
  const chain = [
    'aformat=sample_fmts=fltp:channel_layouts=mono', 'aresample=44100',
    ...pre,
    'silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0:detection=peak',
    'areverse',
    'silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0:detection=peak',
    'areverse',
  ].join(',');
  run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-af', chain, '-c:a', 'pcm_f32le', '-ar', '44100', '-ac', '1', cut]);

  const before = stats(cut);

  // 2. level
  let mode, post;
  if (before.seconds >= 0.4) {
    const m = measureStderr(cut);
    if (Number.isFinite(parseFloat(m.input_i))) {
      mode = 'loudnorm 2-pass linear';
      post = `loudnorm=I=${TARGET_I}:TP=${TARGET_TP}:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}`
           + `:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=summary`;
    }
  }
  if (!post) {
    mode = 'static gain to -18 dBFS RMS (50 ms)';
    const g = Math.pow(10, (SHORT_RMS - before.rms50Db) / 20);
    post = `volume=${g.toFixed(6)}`;
  }
  const fade = `afade=t=in:st=0:d=0.003`;
  run('ffmpeg', ['-v', 'error', '-y', '-i', cut, '-af',
    `${post},${fade},alimiter=level_in=1:level_out=1:limit=${LIMIT.toFixed(4)}:attack=1:release=30:level=disabled`,
    '-c:a', 'pcm_s16le', '-ar', '44100', '-ac', '1', fin]);

  // 3. encode: Vorbis q4 via vorbis-tools (no libvorbis in this ffmpeg), AAC-LC via
  //    ffmpeg. Both codecs overshoot on decode, AAC badly on dense transients —
  //    the Windows chime came back +1.03 dBFS from a file limited to -1.0. So:
  //    encode, decode, and if either codec lands above -0.3 dBFS, pull the master
  //    wav down by the overshoot and do it again. BOTH codecs are re-encoded from
  //    the same wav every time, so .ogg and .m4a never drift apart in level —
  //    Safari has to hear the level Chrome hears.
  let encSrc = fin, trimDb = 0;
  for (let attempt = 0; ; attempt++) {
    run('oggenc', ['-Q', '-q', '4', '-o', outOgg, encSrc]);
    run('ffmpeg', ['-v', 'error', '-y', '-i', encSrc, '-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '96k',
                   '-ar', '44100', '-ac', '1', '-movflags', '+faststart', outM4a]);
    const over = Math.max(stats(outOgg).peakDb, stats(outM4a).peakDb);
    if (over <= -0.3 || attempt >= 3) { if (over > -0.3) console.error(`  ! ${job.out} still peaks at ${over.toFixed(2)} dBFS`); break; }
    trimDb += over + 0.3;
    encSrc = join(TMP, `${base}.trim.wav`);
    run('ffmpeg', ['-v', 'error', '-y', '-i', fin, '-af', `volume=${(-trimDb).toFixed(3)}dB`,
                   '-c:a', 'pcm_s16le', '-ar', '44100', '-ac', '1', encSrc]);
  }

  const after = stats(outOgg), aac = stats(outM4a);
  report.push({ id: job.out, mode, note: job.note,
    seconds: +after.seconds.toFixed(3), peakDb: +after.peakDb.toFixed(2), rms50Db: +after.rms50Db.toFixed(2) });
  console.log(`${job.out.padEnd(16)} ${after.seconds.toFixed(3)}s  ogg peak ${after.peakDb.toFixed(2)}  `
            + `m4a peak ${aac.peakDb.toFixed(2)}  rms50 ${after.rms50Db.toFixed(2)} dBFS`
            + `${trimDb ? `  (-${trimDb.toFixed(2)} dB codec headroom)` : ''}  [${mode}]`);
}

rmSync(TMP, { recursive: true, force: true });
console.log(`\n${report.length}/${JOBS.length} rebuilt`);
