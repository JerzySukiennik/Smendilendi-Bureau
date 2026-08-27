#!/usr/bin/env python3
"""Dev server for Smendilendi Bureau.

Identical to `python3 -m http.server` except that it sends `Cache-Control: no-store`
on everything. That matters more than it sounds: with the stock server the browser
happily reuses a cached ES module or stylesheet after an edit, so you verify a fix
against the old code and conclude it did not work (or, worse, that it did).
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
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
