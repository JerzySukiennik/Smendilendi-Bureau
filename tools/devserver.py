#!/usr/bin/env python3
"""Dev server for Smendilendi Bureau.

Identical to `python3 -m http.server` except that it sends `Cache-Control: no-store`
on everything. That matters more than it sounds: with the stock server the browser
happily reuses a cached ES module or stylesheet after an edit, so you verify a fix
against the old code and conclude it did not work (or, worse, that it did).
"""
import base64
import os
import re
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

SHOT_DIR = "progress/shots"
SHOT_NAME = re.compile(r"^[A-Za-z0-9._-]+\.(png|jpg|jpeg|json|txt)$")


class NoCacheHandler(SimpleHTTPRequestHandler):
    def do_POST(self):
        """POST /__shot/<name>.png with a base64 body -> progress/shots/<name>.

        The one thing a browser cannot do on its own is put a frame on disk.
        The page renders, reads the canvas back, and posts it here, so the
        screenshots in progress/shots/ are the real framebuffer at full
        resolution rather than a scaled capture of the tool pane.
        """
        if not self.path.startswith("/__shot/"):
            self.send_error(404)
            return
        name = self.path[len("/__shot/"):]
        if not SHOT_NAME.match(name):
            self.send_error(400, "bad shot name")
            return
        n = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(n).decode("ascii", "ignore")
        if "," in raw[:64]:
            raw = raw.split(",", 1)[1]
        out_dir = os.path.join(self.directory, SHOT_DIR)
        os.makedirs(out_dir, exist_ok=True)
        path = os.path.join(out_dir, name)
        with open(path, "wb") as fh:
            fh.write(base64.b64decode(raw))
        body = path.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):        # quiet: one line per request is noise
        if not str(args[1] if len(args) > 1 else "").startswith("2"):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5179
    root = sys.argv[2] if len(sys.argv) > 2 else "."
    handler = partial(NoCacheHandler, directory=root)
    print(f"serving {root} on http://localhost:{port} (no-store)")
    ThreadingHTTPServer(("", port), handler).serve_forever()
