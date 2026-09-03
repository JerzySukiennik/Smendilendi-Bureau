// tools/index.js — the tool palette, in the order it appears in the HUD.
//
// The names are the ones an architect already knows (reference/sketchup/ANALYSIS.md
// §1): Line, Rectangle, Wall, Door, Window, Move, Rotate, Scale, Offset,
// Tape Measure, Protractor, Paint Bucket, Eraser, Text (3D), Orbit, Pan,
// Zoom Extents, Section Plane. Zoom Extents is a command (Shift+Z), not a tool.

import { SelectTool } from './select.js';
import { WallTool, LineTool, RectTool, RoomTool, SlabTool } from './draw.js';
import { DoorTool, WindowTool } from './openings.js';
import { MoveTool, RotateTool, ScaleTool, OffsetTool } from './transform.js';
import { TapeTool, ProtractorTool } from './measure-tools.js';
import { PaintTool, EraserTool } from './paint.js';
import { PlaceTool, TextTool } from './place.js';
import { OrbitTool, PanTool, SectionTool } from './nav.js';

export const TOOLS = [
  SelectTool,
  RoomTool,
  LineTool,
  RectTool,
  WallTool,
  DoorTool,
  WindowTool,
  SlabTool,
  PlaceTool,
  MoveTool,
  RotateTool,
  ScaleTool,
  OffsetTool,
  TapeTool,
  ProtractorTool,
  PaintTool,
  EraserTool,
  TextTool,
  SectionTool,
  OrbitTool,
  PanTool,
];

/** Groups for the palette, so the toolbar reads like a real one. */
export const TOOL_GROUPS = [
  // Room comes FIRST and is the tool the editor opens on: dragging a room out
  // is the way in, and the palette has to say so before anything else does.
  { name: 'Build', ids: ['room', 'wall', 'door', 'window'] },
  { name: 'Principal', ids: ['select', 'move', 'rotate', 'scale', 'erase'] },
  { name: 'Draw', ids: ['line', 'rect', 'slab', 'offset'] },
  { name: 'Place', ids: ['place', 'text', 'paint'] },
  { name: 'Measure', ids: ['tape', 'protractor', 'section'] },
  { name: 'Camera', ids: ['orbit', 'pan'] },
];

/** The key each tool answers to, for the palette tooltips. */
export const TOOL_KEYS = {
  select: 'Space', room: 'P', line: 'L', rect: '', wall: 'W', door: 'D', window: 'N',
  slab: 'G', place: 'C', move: 'M', rotate: 'Q', scale: 'S', offset: 'F',
  tape: 'T', protractor: 'A', paint: 'B', erase: 'E', text: 'X',
  section: 'K', orbit: 'O', pan: 'H',
};
