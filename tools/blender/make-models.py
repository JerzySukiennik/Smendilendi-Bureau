"""make-models.py -- the catalogue build.

    node tools/blender/dump-catalog.mjs > tools/blender/_tmp/catalog.json
    /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/make-models.py \
        -- --catalog tools/blender/_tmp/catalog.json [ids...]

Reads the catalogue THROUGH the live JS module (dump-catalog.mjs), builds every
item that has a family script, asserts it, exports a GLB and prints a table.
A build failure is a hard failure: nothing half-connected reaches assets/.
"""

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / 'lib'))

import bpy                                                          # noqa: E402

from build import BuildError, clear_scene, export_glb, finish, tri_count   # noqa: E402
import families                                                     # noqa: E402


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--catalog', required=True)
    ap.add_argument('--out', default=str(ROOT / 'assets' / 'models'))
    ap.add_argument('ids', nargs='*')
    args = ap.parse_args(argv)

    data = json.loads(Path(args.catalog).read_text())
    palette = data['palette']
    entries = {e['id']: e for e in data['catalog']}
    entries.update({p['id']: p for p in data.get('props', [])})

    ids = args.ids or [i for i in families.BUILDERS if i in entries]
    out_dir = Path(args.out)
    report = []
    failures = []

    for item_id in ids:
        entry = dict(entries[item_id])
        if item_id in families.SIZE_OVERRIDES:
            entry['size'] = list(families.SIZE_OVERRIDES[item_id])
        t0 = time.time()
        clear_scene()
        try:
            shape = families.BUILDERS[item_id](entry)
            comps = len(shape.components())
            objs = finish(shape, palette, target_size=shape.declared,
                          fit_axes=families.FIT_AXES.get(item_id, 'xyz'),
                          fit_max=families.FIT_MAX.get(item_id, 0.04))
            lo, hi = shape.bounds()
            path = out_dir / f'{item_id}.glb'
            export_glb(objs, path)
            report.append({
                'id': item_id,
                'parts': len(shape.parts),
                'components': comps,
                'tris': tri_count(objs),
                'slots': sorted({o.name.split('.')[-1] for o in objs}),
                'bbox': [round(hi.x - lo.x, 4), round(hi.y - lo.y, 4), round(hi.z - lo.z, 4)],
                'origin': [round(-(lo.x), 4), round(-(lo.y), 4), round(-(lo.z), 4)],
                'catalog': entries[item_id]['size'],
                'anchor': shape.anchor,
                'kb': round(path.stat().st_size / 1024, 1),
                'ms': round((time.time() - t0) * 1000),
            })
            print(f'  ok  {item_id:24s} {report[-1]["tris"]:5d} tris  '
                  f'{report[-1]["bbox"]}  {report[-1]["kb"]} kB')
        except BuildError as err:
            failures.append(str(err))
            print(f'  FAIL {item_id}: {err}')
        except Exception as err:                       # noqa: BLE001
            import traceback
            traceback.print_exc()
            failures.append(f'{item_id}: {err}')

    out = {'built': report, 'failures': failures}
    (HERE / '_tmp').mkdir(exist_ok=True)
    (HERE / '_tmp' / 'build-report.json').write_text(json.dumps(out, indent=1))
    print(f'\n{len(report)} built, {len(failures)} failed')
    if failures:
        sys.exit(1)


main()
