"""Read-only, deadline-bounded proxy for official IPCET publications."""

import json
import math
import re
import threading
from datetime import date, datetime
from pathlib import Path

import requests

UNAVAILABLE = "No hay una publicación IPCET válida guardada."
UNKNOWN = "Estación IPCET desconocida."
CODE = re.compile(r"[A-Z]{5}")
STATES = {"NORMAL", "A LA BAJA", "BAJO", "PREVENCION", "ALERTA", "EMERGENCIA"}
CAP = 1024 * 1024
FAILURES = (
    OSError,
    requests.RequestException,
    ValueError,
    TypeError,
    KeyError,
    AttributeError,
    OverflowError,
)


def valid_code(value):
    return isinstance(value, str) and CODE.fullmatch(value) is not None


def _shape(value, fields):
    if not isinstance(value, dict) or set(value) != set(fields.split()):
        raise ValueError("Invalid publication shape")


def _date(value):
    if not isinstance(value, str) or date.fromisoformat(value).isoformat() != value:
        raise ValueError("Invalid observation date")


def _level(value):
    if value is not None and (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
    ):
        raise ValueError("Invalid level")


def _state(value):
    if value is not None and (not isinstance(value, str) or value not in STATES):
        raise ValueError("Invalid official state")


def validate_publication(p, kind):
    """Reject malformed network AND disk data without repairing official values."""
    if kind == "levels":
        _shape(p, "schema table_date issued_at last_modified source_url stations")
        if p["schema"] != "ipcet-levels/v1":
            raise ValueError("Invalid schema")
        _date(p["table_date"])
        stamp = datetime.fromisoformat(p["issued_at"].replace("Z", "+00:00"))
        if stamp.tzinfo is None:
            raise ValueError("Missing timestamp offset")
        if not isinstance(p["last_modified"], str) or (
            p["source_url"] is not None and not isinstance(p["source_url"], str)
        ):
            raise ValueError("Invalid metadata")
        if not isinstance(p["stations"], list):
            raise ValueError("Invalid station list")
        for row in p["stations"]:
            _shape(
                row,
                "code river station namo namino ayer hoy diff capacity "
                "semaforo problems",
            )
            if row["code"] is not None and not valid_code(row["code"]):
                raise ValueError("Invalid station code")
            if not all(isinstance(row[k], str) for k in ("river", "station")):
                raise ValueError("Invalid station name")
            for key in ("namo", "namino", "ayer", "hoy", "diff", "capacity"):
                _level(row[key])
            _state(row["semaforo"])
            if not isinstance(row["problems"], list) or not all(
                isinstance(problem, str) for problem in row["problems"]
            ):
                raise ValueError("Invalid problems")
    else:
        _shape(p, "schema stations")
        if p["schema"] != "ipcet-recent/v1" or not isinstance(p["stations"], dict):
            raise ValueError("Invalid recent publication")
        for code, rows in p["stations"].items():
            if not valid_code(code) or not isinstance(rows, list) or len(rows) > 30:
                raise ValueError("Invalid station series")
            previous = ""
            for row in rows:
                _shape(row, "date hoy semaforo")
                _date(row["date"])
                if row["date"] <= previous:
                    raise ValueError("Unordered observation dates")
                previous = row["date"]
                _level(row["hoy"])
                _state(row["semaforo"])
    return p


class IpcetFeed:
    def __init__(self, url, cache_path, *, kind, http=requests, fetch_deadline=3.5):
        self.url = url
        self.cache_path = Path(cache_path)
        self.kind = kind
        self.http = http
        self.fetch_deadline = fetch_deadline
        self.cache_lock = threading.Lock()

    def _fetch(self):
        with self.http.get(
            self.url,
            headers={"Accept": "application/json"},
            timeout=(2, 5),
            allow_redirects=False,
            stream=True,
        ) as response:
            if response.status_code != 200:
                raise ValueError("Unavailable publication")
            body = bytearray()
            for chunk in response.iter_content(chunk_size=8192):
                body.extend(chunk)
                if len(body) > CAP:
                    raise ValueError("Publication too large")
        publication = validate_publication(json.loads(body), self.kind)
        try:
            with self.cache_lock:
                self.cache_path.parent.mkdir(parents=True, exist_ok=True)
                temporary = self.cache_path.with_suffix(".tmp")
                temporary.write_text(
                    json.dumps(publication, allow_nan=False), encoding="utf-8"
                )
                temporary.replace(self.cache_path)
        except OSError:
            pass  # A valid network publication remains usable on read-only disks.
        return publication

    def get(self):
        """Use a daemon to bound total fetch time, including a stalled body."""
        outcome = {}

        def fetch():
            try:
                outcome["publication"] = self._fetch()
            except FAILURES:
                pass

        worker = threading.Thread(target=fetch, daemon=True)
        worker.start()
        worker.join(self.fetch_deadline)
        publication = None if worker.is_alive() else outcome.get("publication")
        if publication is not None:
            return {**publication, "source": "network"}
        try:
            with self.cache_lock:
                if self.cache_path.stat().st_size > CAP:
                    raise ValueError("Cache too large")
                publication = json.loads(self.cache_path.read_text(encoding="utf-8"))
            return {**validate_publication(publication, self.kind), "source": "cache"}
        except FAILURES:
            return None
