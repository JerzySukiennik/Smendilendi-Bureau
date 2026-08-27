// Shared vocabulary of the editor: axis colours, inference names, tool ids.
//
// AXIS NAMING — read this before touching anything spatial.
//
// three.js has Y up. SketchUp (and every architect who has used it) has Z up and
// calls the axes red / green / blue for X / Y / Z. We keep the ARCHITECT'S
// vocabulary in the interface and translate to three's basis internally:
//
//     UI axis   colour    world direction        arrow key
//     X         red       ( 1, 0, 0)             Right   ("Right locks Red")
//     Y         green     ( 0, 0, 1)             Left
//     Z         blue      ( 0, 1, 0)  = up       Up
//     par/perp  magenta   (inference direction)  Down
//
// So "on the blue axis" always means vertical, exactly as it does in SketchUp,
// and red/green/blue really are X/Y/Z as the reference bar demands.

import { Vector3 } from 'three';

export const AXIS = {
  x: { id: 'x', name: 'X', color: 0xd23b2e, dir: new Vector3(1, 0, 0), key: 'ArrowRight' },
  y: { id: 'y', name: 'Y', color: 0x3f9c35, dir: new Vector3(0, 0, 1), key: 'ArrowLeft' },
  z: { id: 'z', name: 'Z', color: 0x2f6fd0, dir: new Vector3(0, 1, 0), key: 'ArrowUp' },
};
export const AXIS_ORDER = ['x', 'y', 'z'];

export const COLOR = {
  axisX: 0xd23b2e,
  axisY: 0x3f9c35,
  axisZ: 0x2f6fd0,
  magenta: 0xc23fb0,      // parallel / perpendicular / inside a group
  cyan: 0x22b3c4,         // midpoint / tangent
  endpoint: 0x3f9c35,     // green
  onEdge: 0xd23b2e,       // red
  onFace: 0x2f6fd0,       // blue
  center: 0x2f6fd0,       // blue
  intersection: 0x1c1a18, // black X
  guide: 0x8b8378,
  selection: 0x2f6fd0,
  hover: 0xf3ece1,
  ghost: 0xd4763a,
};

/** The official inference names. A snap that cannot name itself is not shipped. */
export const INFERENCE = {
  ENDPOINT:      { name: 'Endpoint',      color: COLOR.endpoint,     marker: 'square', rank: 100 },
  INTERSECTION:  { name: 'Intersection',  color: COLOR.intersection, marker: 'cross',  rank: 95 },
  MIDPOINT:      { name: 'Midpoint',      color: COLOR.cyan,         marker: 'dot',    rank: 90 },
  CENTER:        { name: 'Center',        color: COLOR.center,       marker: 'ring',   rank: 85 },
  ON_EDGE:       { name: 'On Edge',       color: COLOR.onEdge,       marker: 'dot',    rank: 70 },
  ON_LINE:       { name: 'On Line',       color: COLOR.onEdge,       marker: 'dot',    rank: 65 },
  PERPENDICULAR: { name: 'Perpendicular', color: COLOR.magenta,      marker: 'dot',    rank: 62 },
  PARALLEL:      { name: 'Parallel',      color: COLOR.magenta,      marker: 'dot',    rank: 60 },
  AXIS_X:        { name: 'On Red Axis',   color: COLOR.axisX,        marker: 'dot',    rank: 50 },
  AXIS_Y:        { name: 'On Green Axis', color: COLOR.axisY,        marker: 'dot',    rank: 50 },
  AXIS_Z:        { name: 'On Blue Axis',  color: COLOR.axisZ,        marker: 'dot',    rank: 50 },
  FROM_POINT:    { name: 'From Point',    color: COLOR.guide,        marker: 'dot',    rank: 45 },
  ON_FACE:       { name: 'On Face',       color: COLOR.onFace,       marker: 'dot',    rank: 20 },
  GRID:          { name: 'On Face',       color: COLOR.onFace,       marker: 'dot',    rank: 10 },
};

/** Screen-space radius, in CSS pixels, inside which a candidate snaps. */
export const SNAP_PX = 14;

/** Plan grid, metres. An architect draws to 100 mm unless told otherwise. */
export const GRID = 0.1;
export const FINE_GRID = 0.01;

/** Eye height for the walkthrough preview — a standing adult's eye, not a camera. */
export const EYE_HEIGHT = 1.65;

/** Undo history depth by in-game computer tier (DESIGN-DECISIONS.md). */
export const HISTORY_BY_TIER = [8, 8, 24, 80, 250];

export const DEFAULT_DOOR = 'door-internal-900';   // 0.90 x 2.05 m, the real leaf
export const DEFAULT_WINDOW = 'window-1200x1400';  // 1.20 x 1.40 m, sill 0.85
