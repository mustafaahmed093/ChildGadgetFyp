"""Static development server for the ChildLink web application."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os


ROOT = Path(__file__).resolve().parent / "web"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    address = ("127.0.0.1", int(os.environ.get("CHILDLINK_PORT", "8000")))
    print(f"ChildLink web app: http://localhost:{address[1]}", flush=True)
    print("Configure web/firebase-config.js before signing in.", flush=True)
    print("Press Ctrl+C to stop.", flush=True)
    ThreadingHTTPServer(address, Handler).serve_forever()
