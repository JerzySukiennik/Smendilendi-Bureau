// lobby.js — everything in the menu that is words rather than architecture.
//
// The 3D scene owns the buttons; this file owns what happens after one is
// clicked: who you are, which office you are joining, the settings, the credits,
// and the surveyor's report that makes the building's crimes readable.
//
// Deliberately plain DOM. It sits in #ui, which is pointer-events:none with its
// children re-enabled (src/style.css), so the scene stays hoverable underneath
// every chip and only a real panel blocks it.

import {
  createSession, formatCode, codeError, parseCode, PLAYER_COLORS,
} from '../net/session.js';
import { isPlaceholderConfig } from '../net/firebase-config.js';

const STORE = 'smendilendi.menu';

/**
 * CREDITS.md in the project root is the audio credit file and is not this
 * agent's to edit, but the credits PANEL is — and a panel that credits 48 CC0
 * sound files while saying nothing about the renderer and the typeface the whole
 * menu is built out of is not a credits panel. This is appended to it.
 */
const SOFTWARE_CREDITS = `
## Software and type

- **three.js** r0.180.0 — MIT licence, (c) 2010-2026 three.js authors (Mr.doob and
contributors). Loaded from unpkg as ES modules; the whole game renders through it.
- **Helvetiker Bold** — the typeface of the rooftop sign and of all four menu
lines, shipped with the three.js examples as \`helvetiker_bold.typeface.json\`.
Derived from Helvetiker by Kenn Munk and distributed under the three.js licence.
- **Firebase JavaScript SDK** — Apache 2.0, used for the shared office session only.
- Everything else in this build — the building, the site, the lettering geometry,
the analysis engine, the retro OS and every line of the interface — was written
for this project.
`;
const MAX_PLAYERS = 3;      // DESIGN-DECISIONS.md: 1-3 players, one shared office

/**
 * `volumes` is DELIBERATELY EMPTY, and must stay empty.
 *
 * It used to be `{ master: 0.9, music: 0.45, ambient: 0.5, sfx: 0.8, ui: 0.7 }` —
 * a third hardcoded copy of assets/audio/mix.json, written onto all five buses by
 * _applyPrefs() every time the menu was entered, i.e. on the first screen of the
 * game. It happened to agree with mix.json, and nothing checked that it did:
 * changing the music bus in mix.json moved the review page's promised level and
 * not a decibel of what the game played, because this object put the old number
 * back. That is exactly the defect the audio sign-off exists to prevent, one file
 * over from where it was found the first time.
 *
 * So this map now holds only the buses the PLAYER has dragged — deviations from
 * mix.json, never the mix itself. The defaults come from the audio bus, which
 * reads mix.json and nothing else. assets/audio/build/verify-signoff.mjs check 10
 * fails the build if a bus-mix literal reappears anywhere outside src/core/audio.js.
 */
const DEFAULTS = {
  nick: '',
  color: PLAYER_COLORS[0],
  volumes: {},
  sensitivity: 0.0022,
  quality: 'auto',
};

/** Slider order and labels. A LIST of pairs, not a map keyed by bus name — the
 *  shape that check 10 forbids is an object whose keys are the mix's buses. */
const BUS_ROWS = [
  ['master', 'Master'], ['music', 'Music'], ['ambient', 'Ambience'],
  ['sfx', 'Effects'], ['ui', 'Interface'],
];

export class Lobby {
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.opts = opts;
    this.crimes = opts.crimes || [];
    this.session = null;
    this.prefs = loadPrefs();
    this._panel = null;
    this._creditsHtml = null;

    ensureStylesheet();
    this._build();
    this._applyPrefs();
  }

  // -- construction ---------------------------------------------------------

  _build() {
    const host = document.getElementById('ui') || document.body;
    const root = el('div', 'mn-root');
    this.root = root;
    host.appendChild(root);

    // --- who you are, bottom left -----------------------------------------
    const id = el('div', 'mn-chip mn-identity');
    id.innerHTML = `
      <div class="mn-chip-label">Your name on the desk</div>
      <input class="mn-nick" type="text" maxlength="16" spellcheck="false" placeholder="Architect" aria-label="Nickname">
      <div class="mn-chip-label mn-mt">Your colour in the office</div>
      <div class="mn-swatches"></div>`;
    root.appendChild(id);
    this.nickInput = id.querySelector('.mn-nick');
    this.nickInput.addEventListener('input', () => {
      this.prefs.nick = this.nickInput.value;
      savePrefs(this.prefs);
    });
    const sw = id.querySelector('.mn-swatches');
    this.swatches = PLAYER_COLORS.map((c) => {
      const b = el('button', 'mn-swatch');
      b.style.background = c;
      b.title = c;
      b.setAttribute('aria-label', `Player colour ${c}`);
      b.addEventListener('click', () => {
        this.prefs.color = c;
        savePrefs(this.prefs);
        this._applyPrefs();
        this.ctx?.audio?.play('ui.click-soft');
      });
      sw.appendChild(b);
      return b;
    });

    // --- top right: the surveyor's report ---------------------------------
    const tools = el('div', 'mn-tools');
    if (this.crimes.length) {
    this.reportBtn = el('button', 'mn-btn mn-btn-ghost');
    this.reportBtn.innerHTML = `<span class="mn-dot"></span>Surveyor's report <b>${this.crimes.length}</b>`;
    this.reportBtn.addEventListener('click', () => this.openReport());
    // hovering the chip brings all twelve tags up in the 3D scene
    this.reportBtn.addEventListener('mouseenter', () => this.opts.onTagsHot?.(true));
    this.reportBtn.addEventListener('mouseleave', () => this.opts.onTagsHot?.(false));
    tools.appendChild(this.reportBtn);
    }
    root.appendChild(tools);

    // --- bottom right: the hint -------------------------------------------
    // BLUE, not orange. The discs in the scene are survey blue (#3f6a86, set by
    // TAG_FACE in menu.js) and have been since the round that moved them off the
    // accent; this sentence was not updated with them and spent a whole round
    // telling the player to look for a colour that is not there. The chips in
    // the report panel are orange, which is why it read as true to whoever wrote
    // it — but this line points at the scene, not at the panel.
    const hint = el('div', 'mn-hint');
    hint.innerHTML = `The signage is the menu — hover a line.<br>
      <span class="mn-dim">The blue tags are the ${this.crimes.length} defects. Click one and the camera goes there.</span>`;
    root.appendChild(hint);
    this.hint = hint;

    // --- the tag tooltip ---------------------------------------------------
    this.tagCard = el('div', 'mn-tag');
    this.tagCard.hidden = true;
    root.appendChild(this.tagCard);

    // --- the modal layer ---------------------------------------------------
    this.veil = el('div', 'mn-veil');
    this.veil.hidden = true;
    this.veil.addEventListener('mousedown', (e) => { if (e.target === this.veil) this.closePanel(); });
    root.appendChild(this.veil);

    this._onKey = (e) => {
      if (e.key === 'Escape' && this._panel) { e.stopPropagation(); this.closePanel(); }
    };
    window.addEventListener('keydown', this._onKey);
  }

  _applyPrefs() {
    this.nickInput.value = this.prefs.nick || '';
    this.swatches.forEach((b, i) => b.classList.toggle('on', PLAYER_COLORS[i] === this.prefs.color));
    // mix.json supplies every default; this only replays the player's own moves.
    this.ctx?.audio?.applyUserVolumes?.(this.prefs.volumes);
    if (this.ctx?.input) this.ctx.input.mouseSensitivity = this.prefs.sensitivity;
    this._applyQuality();
  }

  _applyQuality() {
    const engine = this.ctx?.engine;
    if (!engine) return;
    const q = this.prefs.quality;
    if (q === 'auto') engine.unlockPixelRatio();
    else engine.lockPixelRatio(q === 'low' ? 1.0 : q === 'medium' ? 1.25 : 1.75);
  }

  get nick() { return (this.prefs.nick || '').trim() || 'Architect'; }
  get color() { return this.prefs.color; }

  // -- visibility -----------------------------------------------------------

  show() { this.root.hidden = false; }

  hide() {
    this.root.hidden = true;
    this.closePanel();
  }

  resize() { /* the layout is pure CSS; nothing to recompute */ }

  dispose() {
    window.removeEventListener('keydown', this._onKey);
    this.root?.remove();
    try { this.session?.leave(); } catch (_) { /* already gone */ }
  }

  // -- the surveyor's tag tooltip -------------------------------------------

  /**
   * `at` is {x, y} in 0..1 viewport space, from the mode's projection.
   *
   * Two states. HOVERING, the card chases the disc and stays off the defect it
   * is diagnosing. PINNED — the camera has flown to that crime's own framing —
   * it parks in the top-left corner and grows a `‹ 4 / 12 ›` stepper, because
   * once the camera is doing the work the card must stop moving and must offer
   * a way through the schedule without going back to the hero shot each time.
   */
  showTag(crime, at, pinned = false) {
    const i = this.crimes.indexOf(crime);
    this.tagCard.classList.toggle('mn-tag-pinned', !!pinned);
    this.tagCard.innerHTML = `
      <div class="mn-tag-head"><b>${crime.n}</b>${esc(crime.title)}</div>
      <p>${esc(crime.text)}</p>
      <div class="mn-tag-code">${esc(crime.code)}</div>
      ${pinned ? `<div class="mn-step">
        <button class="mn-step-b" data-step="-1" aria-label="Previous defect">&#8249;</button>
        <span>${i + 1} / ${this.crimes.length}</span>
        <button class="mn-step-b" data-step="1" aria-label="Next defect">&#8250;</button>
        <button class="mn-step-x" data-step="0">Back to the street</button>
      </div>` : ''}`;
    this.tagCard.hidden = false;
    if (pinned) {
      // A fixed berth. Nothing here may follow the pointer: the player is
      // reading, and the camera is already moving.
      this.tagCard.style.left = '';
      this.tagCard.style.top = '';
      this.tagCard.querySelectorAll('[data-step]').forEach((b) => {
        b.addEventListener('click', () => {
          const d = Number(b.dataset.step);
          const n = this.crimes.length;
          this.opts.onCrimeFocus?.(d === 0 ? -1 : (i + d + n) % n);
        });
      });
      return;
    }
    const w = window.innerWidth, h = window.innerHeight;
    // The card goes on the side of the pin with room for it, so it never lands
    // on the defect it is diagnosing — round 1 put tag 2's card straight over the
    // top of the escape stair.
    const cw = this.tagCard.offsetWidth || 340;
    const ch = this.tagCard.offsetHeight || 200;
    const px = at.x * w, py = at.y * h;
    const left = px + 22 + cw < w - 12 ? px + 22 : Math.max(12, px - 22 - cw);
    const top = Math.min(Math.max(py - 30, 12), Math.max(12, h - ch - 12));
    this.tagCard.style.left = `${Math.round(left)}px`;
    this.tagCard.style.top = `${Math.round(top)}px`;
  }

  hideTag() {
    this.tagCard.hidden = true;
    this.tagCard.classList.remove('mn-tag-pinned');
  }

  // -- panels ---------------------------------------------------------------

  _openPanel(title, bodyHtml, cls = '') {
    this.closePanel();
    const p = el('div', `mn-panel ${cls}`);
    p.innerHTML = `
      <header><h2>${esc(title)}</h2><button class="mn-x" aria-label="Close">&#215;</button></header>
      <div class="mn-body">${bodyHtml}</div>`;
    p.querySelector('.mn-x').addEventListener('click', () => this.closePanel());
    this.veil.appendChild(p);
    this.veil.classList.toggle('mn-veil-dock', cls.includes('mn-dock'));
    this.veil.hidden = false;
    this._panel = p;
    this.opts.onBlock?.(true);
    if (cls.includes('mn-wide') || cls.includes('mn-dock')) this.opts.onTagsHot?.(true);
    // A docked panel tells the mode how much of the frame it has taken, and the
    // camera pans so the building stands in the half that is left. A modal that
    // covers the thing it is describing is the failure this round is fixing.
    this.opts.onDock?.(cls.includes('mn-dock') ? (p.offsetWidth + 44) : 0);
    this.hideTag();
    this.ctx?.audio?.play('ui.window-open');
    return p;
  }

  closePanel() {
    if (!this._panel) return;
    this._panel.remove();
    this._panel = null;
    this.veil.hidden = true;
    this.veil.classList.remove('mn-veil-dock');
    this.opts.onBlock?.(false);
    this.opts.onTagsHot?.(false);
    this.opts.onDock?.(0);
    this.ctx?.audio?.play('ui.window-close');
  }

  // -- single player --------------------------------------------------------

  startSingle() {
    const session = createSession({ mode: 'local', nick: this.nick, color: this.color });
    this.session = session;
    session.ready.then(() => this.opts.onAction?.('enter-office', session))
      .catch((err) => {
        console.warn('[menu] local session failed', err);
        this._openPanel('Could not open the office', `<p class="mn-bad">${esc(String(err?.message || err))}</p>`);
      });
  }

  // -- multiplayer ----------------------------------------------------------

  openMultiplayer() {
    // With placeholder Firebase credentials there is no network, so "join" can
    // only ever succeed at joining an office that does not exist. Round 1
    // accepted a valid-shaped code offline and dropped the player into an empty
    // room that looked like a successful join. An honest disabled button and one
    // sentence of why is better than a working-looking lie.
    const offline = isPlaceholderConfig();
    const p = this._openPanel('Multiplayer', `
      <p class="mn-lead">One shared office, one shared model, up to ${MAX_PLAYERS} architects.
      No accounts — the office code is the key.</p>
      <div class="mn-row">
        <button class="mn-btn mn-btn-primary" data-a="host">Open a new office</button>
        <button class="mn-btn" data-a="join"${offline ? ' disabled' : ''}>Join with a code</button>
      </div>
      ${offline ? `<div class="mn-status warn">This build has no Firebase credentials
        (<code>src/net/firebase-config.js</code> still holds placeholders), so there is nothing
        to join. Opening an office still works — it just runs on this machine alone.</div>` : ''}
      <div class="mn-slot"></div>`);
    p.querySelector('[data-a="host"]').addEventListener('click', () => this._host());
    const join = p.querySelector('[data-a="join"]');
    if (!offline) join.addEventListener('click', () => this._joinForm());
  }

  _joinForm() {
    const slot = this._panel.querySelector('.mn-slot');
    slot.innerHTML = `
      <label class="mn-field">
        <span>Office code</span>
        <input class="mn-code-input" type="text" maxlength="9" spellcheck="false"
               autocapitalize="characters" placeholder="ABCD-EFGH" aria-label="Office code">
      </label>
      <div class="mn-err" hidden></div>
      <div class="mn-row"><button class="mn-btn mn-btn-primary" data-a="go">Join the office</button></div>`;
    const input = slot.querySelector('.mn-code-input');
    const err = slot.querySelector('.mn-err');
    const go = () => {
      const msg = codeError(input.value);
      if (msg) {
        err.textContent = msg;
        err.hidden = false;
        this.ctx?.audio?.play('ui.error');
        return;
      }
      err.hidden = true;
      this._connect({ mode: 'online', code: parseCode(input.value) });
    };
    input.addEventListener('input', () => {
      const v = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      input.value = v.length > 4 ? `${v.slice(0, 4)}-${v.slice(4, 8)}` : v;
      err.hidden = true;
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    slot.querySelector('[data-a="go"]').addEventListener('click', go);
    input.focus();
  }

  _host() { this._connect({ mode: 'online' }); }

  _connect(opts) {
    const slot = this._panel.querySelector('.mn-slot');
    slot.innerHTML = '<div class="mn-lead">Connecting…</div>';
    try { this.session?.leave(); } catch (_) { /* nothing to leave */ }
    const session = createSession({ ...opts, nick: this.nick, color: this.color });
    this.session = session;
    session.on('players', () => this._renderLobby());
    session.on('status', () => this._renderLobby());
    session.ready.then(() => this._renderLobby()).catch((err) => {
      slot.innerHTML = `<p class="mn-bad">${esc(String(err?.message || err))}</p>`;
    });
  }

  _renderLobby() {
    const s = this.session;
    if (!s || !this._panel) return;
    const slot = this._panel.querySelector('.mn-slot');
    if (!slot) return;
    const online = s.kind === 'rtdb';
    const players = s.players?.length ? s.players : [{ id: s.playerId, nick: s.nick, color: s.color, isHost: s.isHost }];

    slot.innerHTML = `
      <div class="mn-code">
        <div class="mn-chip-label">Office code</div>
        <div class="mn-code-value" role="text">${esc(formatCode(s.code))}</div>
        <button class="mn-btn mn-btn-ghost mn-copy">Copy</button>
      </div>
      <div class="mn-status ${online ? 'ok' : 'warn'}">
        ${online ? 'Online — anyone with this code can walk in.'
      : `Offline — ${esc(s.warning || 'Firebase is not configured in this build')}. The office still runs; nobody can join over the network yet.`}
      </div>
      <div class="mn-chip-label mn-mt">In the office (${players.length}/${MAX_PLAYERS})</div>
      <ul class="mn-players">${players.map((p) => `
        <li><i style="background:${esc(p.color || '#888')}"></i>${esc(p.nick || 'Architect')}
        ${p.isHost ? '<em>host</em>' : ''}${p.id === s.playerId ? '<em>you</em>' : ''}</li>`).join('')}</ul>
      <div class="mn-row"><button class="mn-btn mn-btn-primary" data-a="enter">Walk into the office</button></div>`;

    slot.querySelector('.mn-copy').addEventListener('click', async (e) => {
      try {
        await navigator.clipboard.writeText(s.code);
        e.target.textContent = 'Copied';
        setTimeout(() => { e.target.textContent = 'Copy'; }, 1400);
      } catch (_) {
        // clipboard is permissioned; select the text so the player can copy it
        const r = document.createRange();
        r.selectNodeContents(slot.querySelector('.mn-code-value'));
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        e.target.textContent = 'Selected — press ⌘C';
      }
    });
    slot.querySelector('[data-a="enter"]').addEventListener('click', () => {
      this.closePanel();
      this.opts.onAction?.('enter-office', s);
    });
  }

  // -- settings -------------------------------------------------------------

  openSettings() {
    // Where a slider STARTS is the live bus level — mix.json plus whatever this
    // player has already moved. This screen never names a default of its own.
    const live = this.ctx?.audio?.volumes || {};
    const row = ([id, label]) => {
      const val = typeof live[id] === 'number' ? live[id] : 0;
      return `
      <label class="mn-slider">
        <span>${esc(label)}</span>
        <input type="range" min="0" max="1" step="0.01" value="${val}" data-vol="${id}">
        <b>${Math.round(val * 100)}</b>
      </label>`;
    };
    const p = this._openPanel('Settings', `
      <div class="mn-chip-label">Sound</div>
      ${BUS_ROWS.map(row).join('')}
      <div class="mn-chip-label mn-mt">Mouse</div>
      <label class="mn-slider">
        <span>Look sensitivity</span>
        <input type="range" min="0.0006" max="0.006" step="0.0001" value="${this.prefs.sensitivity}" data-sens>
        <b>${(this.prefs.sensitivity * 1000).toFixed(1)}</b>
      </label>
      <div class="mn-chip-label mn-mt">Quality</div>
      <div class="mn-seg" role="group">
        ${['auto', 'low', 'medium', 'high'].map((q) => `<button data-q="${q}" class="${this.prefs.quality === q ? 'on' : ''}">${q[0].toUpperCase()}${q.slice(1)}</button>`).join('')}
      </div>
      <p class="mn-dim mn-mt">Auto watches the frame time over a two-second window and steps the
      render scale between 1.00 and ${(this.ctx?.engine?.maxRatio ?? 1.75).toFixed(2)}. Locking it stops that.</p>`);

    p.querySelectorAll('[data-vol]').forEach((i) => {
      i.addEventListener('input', () => {
        const bus = i.dataset.vol;
        const val = Number(i.value);
        // setUserVolume returns the deviation map — only the buses this player has
        // actually moved — which is the only thing that may be persisted.
        this.prefs.volumes = this.ctx?.audio?.setUserVolume?.(bus, val) ?? this.prefs.volumes;
        i.parentElement.querySelector('b').textContent = String(Math.round(val * 100));
        savePrefs(this.prefs);
      });
      i.addEventListener('change', () => this.ctx?.audio?.play('ui.click-soft'));
    });
    const sens = p.querySelector('[data-sens]');
    sens.addEventListener('input', () => {
      this.prefs.sensitivity = Number(sens.value);
      if (this.ctx?.input) this.ctx.input.mouseSensitivity = this.prefs.sensitivity;
      sens.parentElement.querySelector('b').textContent = (this.prefs.sensitivity * 1000).toFixed(1);
      savePrefs(this.prefs);
    });
    p.querySelectorAll('[data-q]').forEach((b) => {
      b.addEventListener('click', () => {
        this.prefs.quality = b.dataset.q;
        savePrefs(this.prefs);
        p.querySelectorAll('[data-q]').forEach((o) => o.classList.toggle('on', o === b));
        this._applyQuality();
        this.ctx?.audio?.play('ui.click');
      });
    });
  }

  // -- credits --------------------------------------------------------------

  openCredits() {
    const p = this._openPanel('Credits', '<div class="mn-lead">Reading CREDITS.md…</div>', 'mn-wide');
    const body = p.querySelector('.mn-body');
    if (this._creditsHtml) { body.innerHTML = this._creditsHtml; return; }
    fetch('CREDITS.md')
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
      .then((md) => {
        this._creditsHtml = renderMarkdown(md) + renderMarkdown(SOFTWARE_CREDITS);
        if (this._panel === p) body.innerHTML = this._creditsHtml;
      })
      .catch((err) => {
        if (this._panel === p) {
          body.innerHTML = `<p class="mn-bad">CREDITS.md could not be read (${esc(String(err.message || err))}).</p>
          <p class="mn-dim">Every sound in this game is CC0 1.0. The full table lives in CREDITS.md
          in the project root.</p>`;
        }
      });
  }

  // -- the surveyor's report ------------------------------------------------

  /**
   * The schedule, DOCKED down the left rather than centred over the scene.
   *
   * Hovering a row already flew the camera to that crime — and the panel it flew
   * behind was 880 px of opaque card in the middle of the screen, so the player
   * read twelve diagnoses of a building they could not see. It is a 430 px
   * column now, the veil no longer dims, and _openPanel hands the mode the width
   * so the camera pans the building into the clear half of the frame.
   */
  openReport(focus = -1) {
    const rows = this.crimes.map((c) => `
      <li data-n="${c.n}" class="${c.n - 1 === focus ? 'on' : ''}">
        <b>${c.n}</b>
        <div><h3>${esc(c.title)}</h3><p>${esc(c.text)}</p><div class="mn-tag-code">${esc(c.code)}</div></div>
      </li>`).join('');
    const p = this._openPanel("Surveyor's report — 17 Ambition Road", `
      <p class="mn-lead">Condition survey, ${this.crimes.length} defects, all visible from the street.
      Every one of them is a real thing a real building has done to a real architect.
      Point at a line and the camera goes and stands in front of it.</p>
      <ol class="mn-report">${rows}</ol>`, 'mn-dock');
    if (focus >= 0) {
      const li = p.querySelector(`li[data-n="${focus + 1}"]`);
      li?.scrollIntoView({ block: 'center' });
    }
    p.querySelectorAll('li').forEach((li) => {
      li.addEventListener('mouseenter', () => this.opts.onCrimeFocus?.(Number(li.dataset.n) - 1));
    });
  }

  // -- the honest dead end --------------------------------------------------

  notBuiltYet() {
    this._openPanel('The office is not in this build yet', `
      <p class="mn-lead">The session is open and you are in it — but <code>src/office/</code> is being
      written by another agent right now, so there is nowhere to walk to.</p>
      <ul class="mn-facts">
        <li><span>Office code</span><b>${esc(formatCode(this.session?.code || ''))}</b></li>
        <li><span>You</span><b>${esc(this.nick)}</b></li>
        <li><span>Transport</span><b>${esc(this.session?.kind || 'local')}</b></li>
        <li><span>Host</span><b>${this.session?.isHost ? 'yes' : 'no'}</b></li>
      </ul>
      <p class="mn-dim">Close this and the menu carries on. Nothing was lost.</p>`);
  }
}

// ---------------------------------------------------------------------------
// helpers

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Anyone who played build 1 has all five bus levels sitting in localStorage as
 * absolute numbers, written there by the DEFAULTS map that used to live at the
 * top of this file. Restoring those as "the player's own choices" would pin the
 * old mix onto the bus forever and reopen the exact defect this build closed, so
 * a prefs blob from before the change loses its volumes and keeps everything else.
 */
const PREFS_VERSION = 2;

function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || '{}');
    const volumes = raw.v === PREFS_VERSION ? (raw.volumes || {}) : {};
    return { ...DEFAULTS, ...raw, v: PREFS_VERSION, volumes: { ...volumes } };
  } catch (_) {
    return { ...DEFAULTS, v: PREFS_VERSION, volumes: {} };
  }
}

function savePrefs(p) {
  try { localStorage.setItem(STORE, JSON.stringify({ ...p, v: PREFS_VERSION })); } catch (_) { /* private mode */ }
}

/**
 * Just enough Markdown for CREDITS.md: headings, paragraphs, pipe tables and
 * inline links/code. Everything is escaped first, so the file cannot inject
 * markup even if somebody pastes some into it.
 */
export function renderMarkdown(md) {
  const lines = String(md).split(/\r?\n/);
  const out = [];
  let table = null;
  const flush = () => {
    if (!table) return;
    out.push(`<div class="mn-table-wrap"><table><thead><tr>${table.head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${table.rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    table = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*\|/.test(line)) {
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
      if (/^[\s|:-]+$/.test(line)) continue;                 // the ---|--- rule
      if (!table) table = { head: cells, rows: [] };
      else table.rows.push(cells);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`); continue; }
    if (/^[-*]\s+/.test(line)) { out.push(`<p class="mn-li">${inline(line.replace(/^[-*]\s+/, ''))}</p>`); continue; }
    out.push(`<p>${inline(line)}</p>`);
  }
  flush();
  return out.join('\n');
}

function inline(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  t = t.replace(/&lt;(https?:[^&\s]+)&gt;/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  return t;
}

let _styled = false;
function ensureStylesheet() {
  if (_styled || document.querySelector('link[data-menu-css]')) { _styled = true; return; }
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('./menu.css', import.meta.url).href;
  l.setAttribute('data-menu-css', '');
  document.head.appendChild(l);
  _styled = true;
}
