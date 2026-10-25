"""Harbor tabletop server. One local session, no hospital network access."""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from harbor.session import DecisionError, Session

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
LOCK = threading.Lock()
SESSION = {"current": None}

FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))

    def _send(self, code, body, content_type):
        data = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _json(self, code, payload):
        self._send(code, json.dumps(payload), "application/json; charset=utf-8")

    def _read_json(self):
        length = int(self.headers.get("Content-Length", "0") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/session":
            with LOCK:
                current = SESSION["current"]
                payload = current.view() if current else {"active": False}
            self._json(200, payload)
            return
        if path in FILES:
            name, content_type = FILES[path]
            self._send(200, (WEB / name).read_bytes(), content_type)
            return
        self._json(404, {"error": "Not found."})

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        try:
            body = self._read_json()
        except json.JSONDecodeError:
            self._json(400, {"error": "Request body must be JSON."})
            return

        if path == "/api/session":
            with LOCK:
                SESSION["current"] = Session()
                payload = SESSION["current"].view()
            self._json(200, payload)
            return

        if path == "/api/session/decide":
            action_id = body.get("action_id", "")
            decision = body.get("decision", "")
            with LOCK:
                current = SESSION["current"]
                if current is None:
                    self._json(400, {"error": "Open the incident first."})
                    return
                try:
                    payload = current.decide(action_id, decision)
                except DecisionError as exc:
                    self._json(400, {"error": str(exc)})
                    return
            self._json(200, payload)
            return

        self._json(404, {"error": "Not found."})


def main():
    server = None
    port = None
    for candidate in range(8765, 8775):
        try:
            server = ThreadingHTTPServer(("127.0.0.1", candidate), Handler)
            port = candidate
            break
        except OSError:
            continue
    if server is None:
        raise SystemExit("No free port between 8765 and 8774.")
    print(f"Harbor tabletop at http://127.0.0.1:{port}", flush=True)
    print("Simulation only. This process does not connect to a hospital network.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()