// files.js — Projects. The file browser, the save/load of design variants, and
// the launcher for the 3D editor.
//
// Details view, exactly like an Explorer window: a raised column header, 16x16
// icons, Name / Size / Type / Modified, a selected row in Highlight navy, and a
// status bar counting objects. Double-clicking Design.exe opens the editor,
// which another agent registers with os.registerApp({ id:'editor', ... }); if it
// is not installed the OS says so rather than pretending.

import {
  fill, hline, vline, bevel, field, headerRow, statusBar, inside, textY, clipped,
} from '../widgets.js';
import { SANS, SANS_BOLD } from '../font.js';
import { I16 } from '../icons.js';
import { toolbar, toolbarHit, ListView, ROW_H, dateShort } from './common.js';

export class FilesApp {
  constructor(ctx, os, win) {
    this.ctx = ctx;
    this.os = os;
    this.win = win;
    this.title = 'Projects';
    this.list = new ListView(ROW_H);
    this.path = ['Projects'];
    this.tools = [
      { id: 'up', icon: 'folderOpen' },
      { sep: true },
      { id: 'save', icon: 'floppy' },
      { id: 'delete', icon: 'bin' },
      { sep: true },
      { id: 'design', icon: 'design' },
    ];
    this.toolState = {};
    this.menu = [
      { label: '&File', items: [
        { label: '&Open', accel: 'Enter', id: 'open' },
        { label: '&Save Variant...', accel: 'Ctrl+S', id: 'save' },
        { sep: true },
        { label: '&Delete', accel: 'Del', id: 'delete' },
        { sep: true },
        { label: '&Close', id: 'close' },
      ] },
      { label: '&Edit', items: [
        { label: '&Copy', accel: 'Ctrl+C', id: 'copy' },
        { label: '&Rename', accel: 'F2', id: 'rename' },
      ] },
      { label: '&View', items: [
        { label: 'Lar&ge Icons', id: 'large' },
        { label: '&Details', id: 'details', checked: true },
        { sep: true },
        { label: '&Refresh', accel: 'F5', id: 'refresh' },
      ] },
      { label: '&Help', items: [{ label: '&About Projects', id: 'about' }] },
    ];
    this.list.onActivate = (i) => this.activate(i);
    this.refresh();
  }

  mount() {}
  unmount() {}

  get variants() {
    if (!this.os.variants.length) {
      const now = Date.now();
      this.os.variants = [
        { name: 'scheme-a', type: 'Design variant', size: 41, at: now - 5400e3, model: null },
        { name: 'scheme-b-wider-hall', type: 'Design variant', size: 44, at: now - 2700e3, model: null },
        { name: 'final_final_v3_REALLY_FINAL', type: 'Design variant', size: 44, at: now - 900e3, model: null },
      ];
    }
    return this.os.variants;
  }

  refresh() {
    const here = this.path[this.path.length - 1];
    const rows = [];
    if (this.path.length > 1) rows.push({ name: '..', icon: 'folderOpen', type: 'Parent folder', up: true });
    if (here === 'Projects') {
      rows.push({ name: 'Variants', icon: 'folder', type: 'File folder', folder: 'Variants' });
      rows.push({ name: 'System', icon: 'folder', type: 'File folder', folder: 'System' });
      rows.push({ name: 'Design.exe', icon: 'design', type: 'Application', size: 704, at: Date.now() - 86400e3 * 210, run: 'editor' });
      rows.push({ name: 'brief.txt', icon: 'doc', type: 'Text document', size: 3, at: Date.now() - 26 * 3600e3, run: 'mail' });
      rows.push({ name: 'bill-of-quantities.wks', icon: 'cost', type: 'Worksheet', size: 12, at: Date.now() - 2 * 3600e3, run: 'cost' });
      rows.push({ name: 'README.TXT', icon: 'doc', type: 'Text document', size: 1, at: Date.now() - 86400e3 * 700, note: readme });
    } else if (here === 'Variants') {
      for (const v of this.variants) rows.push({ name: `${v.name}.plan`, icon: 'doc', type: v.type, size: v.size, at: v.at, variant: v });
    } else if (here === 'System') {
      rows.push({ name: 'AUTOEXEC.BAT', icon: 'doc', type: 'MS-DOS batch file', size: 1, at: Date.now() - 86400e3 * 900, note: autoexec });
      rows.push({ name: 'PLOTTER.DRV', icon: 'printer', type: 'Device driver', size: 62, at: Date.now() - 86400e3 * 880, note: 'The driver is fine. The plotter is out of magenta.' });
      rows.push({ name: 'CHICAGO.FON', icon: 'doc', type: 'Font file', size: 38, at: Date.now() - 86400e3 * 880, note: 'A bitmap font. Do not replace it with an outline one.' });
      rows.push({ name: 'TRESTLE.INI', icon: 'settings', type: 'Configuration settings', size: 2, at: Date.now() - 86400e3 * 12, note: 'ShowWindowContentsWhileDragging=0\n; leave it at 0 on this machine' });
    }
    this.rows = rows;
    this.list.sel = Math.min(this.list.sel, Math.max(0, rows.length - 1));
  }

  activate(i) {
    const r = this.rows[i];
    if (!r) return;
    if (r.up) { this.path.pop(); this.refresh(); this.list.sel = 0; }
    else if (r.folder) { this.path.push(r.folder); this.refresh(); this.list.sel = 0; }
    else if (r.run === 'editor') this.launchEditor();
    else if (r.run) this.os.openApp(r.run);
    else if (r.variant) this.loadVariant(r.variant);
    else if (r.note) {
      this.os.wm.dialog({ title: r.name, icon: 'info', w: 400, h: 170, message: r.note });
    }
    this.os.invalidate();
  }

  launchEditor() {
    if (this.os.apps.has('editor')) { this.os.openApp('editor'); return; }
    this.os.play('ui.error');
    this.os.wm.dialog({
      title: 'Design.exe', icon: 'warning', w: 380, h: 150,
      message: 'The Design module is not installed on this machine.\n\nIt is registered by the editor with\nos.registerApp({ id: "editor", ... }).',
    });
  }

  loadVariant(v) {
    this.os.emit('variant:load', v);
    this.os.wm.dialog({
      title: 'Open variant', icon: 'info', w: 360, h: 140,
      message: `${v.name}.plan\n${v.size} KB, saved ${dateShort(v.at)}.\n\nThe model in the editor is replaced.`,
      buttons: ['&OK', '&Cancel'],
      onResult: (i) => { if (i === 0) this.os.emit('variant:open', v); },
    });
  }

  saveVariant() {
    const n = this.os.variants.length + 1;
    const v = { name: `scheme-${String.fromCharCode(96 + n)}`, type: 'Design variant', size: 40 + n, at: Date.now(), model: null };
    const max = this.os.grants.maxVariants;
    if (this.os.variants.length >= max) {
      this.os.play('ui.error');
      this.os.wm.dialog({ title: 'Disk full', icon: 'warning', w: 360, h: 140,
        message: `This machine holds ${max} variants.\nDelete one, or work on a better computer.` });
      return;
    }
    this.os.variants.push(v);
    this.os.emit('variant:save', v);
    if (this.path[this.path.length - 1] !== 'Variants') { this.path = ['Projects', 'Variants']; }
    this.refresh();
    this.os.invalidate();
  }

  columns(w) {
    const size = 62, type = 118, when = 112;
    return [
      { label: 'Name', w: Math.max(110, w - size - type - when) },
      { label: 'Size', w: size, align: 'right' },
      { label: 'Type', w: type },
      { label: 'Modified', w: when },
    ];
  }

  paint(g, r) {
    const pal = this.os.theme.pal;
    const mac = this.os.theme.family === 'platinum';
    fill(g, r.x, r.y, r.w, r.h, pal.face);
    toolbar(g, { x: r.x, y: r.y, w: r.w, h: 26 }, this.tools, pal, this.toolState);

    // the address line
    const ay = r.y + 28;
    SANS.draw(g, 'Address', r.x + 4, ay + 3, pal.text);
    const af = field(g, r.x + 52, ay, r.w - 58, 19, pal);
    I16.folder?.draw(g, af.x + 1, af.y - 1);
    SANS.draw(g, this.path.join('\\'), af.x + 20, textY(af.y, af.h), pal.text);

    const statusH = 20;
    const outer = { x: r.x + 2, y: ay + 23, w: r.w - 4, h: r.h - (ay + 23 - r.y) - statusH - 3 };
    const inner = field(g, outer.x, outer.y, outer.w, outer.h, pal);
    const cols = this.columns(inner.w - 16);
    headerRow(g, inner.x, inner.y, inner.w, 17, cols, pal, SANS);
    const body = { x: inner.x, y: inner.y + 17, w: inner.w, h: inner.h - 17 };
    this.list.layout(body, this.rows.length);
    this.list.paint(g, pal, (gg, i, row, on) => {
      const it = this.rows[i];
      const fg = on ? pal.hiliteText : pal.text;
      I16[it.icon]?.draw(gg, row.x + 2, row.y + ((row.h - 16) >> 1));
      const cells = [it.name, it.size != null ? `${it.size} KB` : '', it.type ?? '', it.at ? dateShort(it.at) : ''];
      let x = row.x + 20;
      for (let c = 0; c < cols.length; c++) {
        const cw = cols[c].w - (c === 0 ? 20 : 0);
        const t = SANS.ellipsis(cells[c], cw - 8);
        if (cols[c].align === 'right') SANS.draw(gg, t, x + cw - 6 - SANS.measure(t), textY(row.y, row.h), fg);
        else SANS.draw(gg, t, x + 2, textY(row.y, row.h), fg);
        x += cw;
      }
    }, mac);

    const sel = this.rows[this.list.sel];
    statusBar(g, r.x, r.y + r.h - statusH, r.w, statusH, [
      { w: 108, text: `${this.rows.length} object(s)` },
      { w: 128, text: sel?.size != null ? `${sel.size} KB` : '' },
      { w: -1, text: `${this.os.variants.length} of ${this.os.grants.maxVariants} variants used` },
    ], pal, SANS);
  }

  pointer(ev) {
    if (ev.type === 'move') {
      const t = toolbarHit(this.tools, ev.gx, ev.gy);
      const id = t?.id ?? null;
      if (id !== this.toolState.hot) { this.toolState.hot = id; this.os.invalidate(); }
    }
    if (ev.type === 'down') {
      const t = toolbarHit(this.tools, ev.gx, ev.gy);
      if (t) { this.toolState.down = t.id; this.os.invalidate(); return; }
    }
    if (ev.type === 'up' && this.toolState.down) {
      const t = toolbarHit(this.tools, ev.gx, ev.gy);
      if (t && t.id === this.toolState.down) this.onMenu(t.id);
      this.toolState.down = null;
      this.os.invalidate();
      return;
    }
    if (this.list.pointer(ev)) this.os.invalidate();
  }

  key(ev) {
    if (this.list.key(ev)) { this.os.invalidate(); return true; }
    if (ev.key === 'F5') { this.refresh(); this.os.invalidate(); return true; }
    return false;
  }

  onMenu(id) {
    switch (id) {
      case 'close': this.os.wm.close(this.win); break;
      case 'open': this.activate(this.list.sel); break;
      case 'up': if (this.path.length > 1) { this.path.pop(); this.refresh(); } break;
      case 'save': this.saveVariant(); break;
      case 'design': this.launchEditor(); break;
      case 'refresh': this.refresh(); break;
      case 'delete': {
        const it = this.rows[this.list.sel];
        if (it?.variant) {
          this.os.variants = this.os.variants.filter((v) => v !== it.variant);
          this.refresh();
        } else {
          this.os.play('ui.error');
          this.os.wm.dialog({ title: 'Delete', icon: 'warning', w: 340, h: 130, message: 'That one is not yours to delete.' });
        }
        break;
      }
      case 'rename':
        this.os.wm.dialog({ title: 'Rename', icon: 'info', w: 360, h: 140,
          message: 'Renaming is not implemented.\nCall the next one scheme-c and move on.' });
        break;
      case 'large':
        this.os.wm.dialog({ title: 'View', icon: 'info', w: 340, h: 130, message: 'Large Icons needs 2 MB of video memory.\nThis machine has 1.' });
        break;
      case 'about':
        this.os.wm.dialog({ title: 'About Projects', icon: 'info', w: 350, h: 140,
          message: `Projects 4.0 for ${this.os.config.osName} ${this.os.config.osVersion}\nHolds ${this.os.grants.maxVariants} design variants on this machine.` });
        break;
      default: break;
    }
    this.os.invalidate();
  }
}

const readme = [
  'Rules of this office, pinned here in 1996 and never revised:',
  '',
  '1. Draw the stairs before the furniture.',
  '2. A corridor under 1.20 m is a corridor you will redraw.',
  '3. If the client says "just one more window", it is never one.',
].join('\n');

const autoexec = [
  '@ECHO OFF',
  'PATH C:\\TRESTLE;C:\\PROJECTS',
  'SET COFFEE=STRONG',
  'REM do not remove the next line, nobody remembers what it does',
  'C:\\TRESTLE\\MOUSE.COM /Y',
].join('\n');

export default FilesApp;
