"""Bounded published forecast reader and optional, request-triggered IPCET courier.

The courier transports bytes only: OCR, input acceptance and modeling belong to
T21. No token or upstream exception is returned to callers or logged here.
"""

import base64
import hashlib
import json
import math
import threading
import time
from datetime import UTC, date, datetime, timedelta
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote, unquote, urljoin, urlsplit
from zoneinfo import ZoneInfo

import requests

DISCLAIMER = (
    "Pronóstico modelado, no es una observación ni un aviso oficial. "
    "Consulte el semáforo oficial de IPCET."
)
CONTENTS = "https://api.github.com/repos/ElGuill3/tabasco-river-forecast/contents/"
MEXICO = ZoneInfo("America/Mexico_City")
UNAVAILABLE = (
    "No hay un pronóstico válido guardado. Intente de nuevo cuando haya conexión."
)


def _timestamp(value):
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise ValueError("Timestamp requires offset")
    return result


def _number(value):
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
    ):
        raise ValueError("Invalid number")
    return value


def validate_forecast(p):
    """Validate v2 publications and disk copies before serving them."""
    if not isinstance(p, dict) or set(p) != {
        "schema",
        "station",
        "issue_time",
        "generated_at",
        "model_version",
        "mode",
        "live_input",
        "forecasts",
        "disclaimer",
    }:
        raise ValueError("Invalid forecast shape")
    if (
        p["schema"] != "bdctb-forecast/v2"
        or p["station"] != {"code": "BDCTB", "name": "Boca del Cerro"}
        or not isinstance(p["model_version"], str)
        or not p["model_version"].strip()
        or p["disclaimer"] != DISCLAIMER
    ):
        raise ValueError("Invalid forecast metadata")
    issue = _timestamp(p["issue_time"]).astimezone(MEXICO)
    _timestamp(p["generated_at"])
    if (issue.hour, issue.minute, issue.second, issue.microsecond) != (11, 0, 0, 0):
        raise ValueError("Invalid issue cutoff")
    live = p["live_input"]
    if p["mode"] == "live":
        if not isinstance(live, dict) or set(live) != {"date", "stage_m", "age_days"}:
            raise ValueError("Invalid live input")
        age = (issue.date() - date.fromisoformat(live["date"])).days
        if (
            type(live["age_days"]) is not int
            or not 0 <= age <= 7
            or live["age_days"] != age
        ):
            raise ValueError("Invalid live age")
        _number(live["stage_m"])
    elif p["mode"] != "glofas_only" or live is not None:
        raise ValueError("Invalid fallback")
    if not isinstance(p["forecasts"], dict) or set(p["forecasts"]) != {
        "h1",
        "h3",
        "h7",
    }:
        raise ValueError("Missing horizons")
    for h in (1, 3, 7):
        point = p["forecasts"][f"h{h}"]
        if not isinstance(point, dict) or set(point) != {
            "target_date",
            "q10",
            "q50",
            "q90",
            "distance_to_namo_m",
            "namo_m",
            "data_kind",
        }:
            raise ValueError("Invalid horizon")
        q10, q50, q90 = (_number(point[q]) for q in ("q10", "q50", "q90"))
        if (
            not q10 <= q50 <= q90
            or point["namo_m"] != 19.21
            or point["data_kind"] != "modeled_not_observed"
            or point["target_date"] != (issue.date() + timedelta(days=h)).isoformat()
            or not math.isclose(
                _number(point["distance_to_namo_m"]), q50 - 19.21, abs_tol=1e-6
            )
        ):
            raise ValueError("Inconsistent horizon")
    return p


def _is_safe_file_name(name):
    """True for a plain file name that cannot leave the upload folder.

    Names come from the remote page, so only letters, digits and a few
    separators are allowed and the first character must be alphanumeric:
    this rejects ``.``, ``..``, hidden names, slashes and control characters.
    """
    return (
        0 < len(name) <= 120
        and name[0].isalnum()
        and all(ch.isalnum() or ch in " ._-+()" for ch in name)
    )


class _ArticleImages(HTMLParser):
    def __init__(self):
        super().__init__()
        self.depth = 0
        self.urls = []

    def handle_starttag(self, tag, attrs):
        if tag == "article":
            self.depth += 1
        if tag == "img" and self.depth:
            attributes = dict(attrs)
            if attributes.get("src"):
                self.urls.append(attributes["src"])
            for candidate in attributes.get("srcset", "").split(","):
                if candidate.strip():
                    self.urls.append(candidate.strip().split()[0])

    def handle_endtag(self, tag):
        if tag == "article":
            self.depth = max(0, self.depth - 1)


class ForecastFeed:
    def __init__(
        self, url, cache_path, *, token="", http=requests, now=None, sleep=time.sleep
    ):
        self.url = url
        self.cache_path = Path(cache_path)
        self.token = token
        self.http = http
        self.now = now or (lambda: datetime.now(UTC))
        self.sleep = sleep
        self.lock = threading.Lock()
        self.cache_lock = threading.Lock()
        self.worker = None
        self.inflight = False
        self.success_dates = set()
        self.pending_since = None
        self.last_ipcet = None

    def _read(self, url, cap, *, headers=None):
        if urlsplit(url).hostname == "tabasco.gob.mx":
            if self.last_ipcet is not None:
                self.sleep(max(0, 1 - (time.monotonic() - self.last_ipcet)))
            self.last_ipcet = time.monotonic()
        with self.http.get(
            url,
            headers=headers or {"Accept": "application/json"},
            timeout=(2, 5),
            allow_redirects=False,
            stream=True,
        ) as response:
            if response.status_code != 200:
                return response.status_code, b"", {}
            body = bytearray()
            for chunk in response.iter_content(chunk_size=8192):
                body.extend(chunk)
                if len(body) > cap:
                    raise ValueError("Response too large")
            return 200, bytes(body), response.headers

    def get(self):
        """Fetch only valid publications; never wait for courier completion."""
        result = None
        try:
            status, body, _ = self._read(self.url, 65536)
            if status != 200:
                raise ValueError("Unavailable publication")
            forecast = validate_forecast(json.loads(body))
            result = {"forecast": forecast, "fetched_at": self.now().isoformat()}
            try:
                with self.cache_lock:
                    self.cache_path.parent.mkdir(parents=True, exist_ok=True)
                    temporary = self.cache_path.with_suffix(".tmp")
                    temporary.write_text(
                        json.dumps(result, allow_nan=False), encoding="utf-8"
                    )
                    temporary.replace(self.cache_path)
            except OSError:
                pass  # An unwritable disk must not hide a valid online publication.
            source = "network"
        except (
            requests.RequestException,
            ValueError,
            TypeError,
            KeyError,
            AttributeError,
            OverflowError,
        ):
            try:
                with self.cache_lock:
                    if self.cache_path.stat().st_size > 65536:
                        raise ValueError("Cache too large")
                    result = json.loads(self.cache_path.read_text(encoding="utf-8"))
                validate_forecast(result["forecast"])
                _timestamp(result["fetched_at"])
                source = "cache"
            except (
                OSError,
                ValueError,
                TypeError,
                KeyError,
                AttributeError,
                OverflowError,
            ):
                result = None
        if result is None:
            return None
        today = self.now().astimezone(MEXICO).date().isoformat()
        live = result["forecast"]["live_input"]
        current = live is not None and live["date"] == today
        with self.lock:
            if current:
                self.pending_since = None
            elif self.token and not self.inflight and today not in self.success_dates:
                self.inflight = True
                self.worker = threading.Thread(
                    target=self._courier, args=(today,), daemon=True
                )
                self.worker.start()
            updating = not current and (
                self.inflight
                or (
                    self.pending_since is not None
                    and (self.now() - self.pending_since).total_seconds() < 1800
                )
            )
        return {
            "forecast": result["forecast"],
            "source": source,
            "fetched_at": result["fetched_at"],
            "updating": bool(updating),
        }

    def _github_headers(self):
        return {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    def _github_read(self, path):
        return self._read(
            CONTENTS + quote(path, safe="/") + "?ref=forecasts",
            12 * 1024 * 1024,
            headers=self._github_headers(),
        )

    def _upload(self, path, body):
        status, existing, _ = self._github_read(path)
        if status not in (200, 404):
            raise ValueError("Contents lookup failed")
        data = {
            "message": "Publish IPCET messenger input",
            "branch": "forecasts",
            "content": base64.b64encode(body).decode("ascii"),
        }
        if status == 200:
            data["sha"] = json.loads(existing)["sha"]
        with self.http.put(
            CONTENTS + quote(path, safe="/"),
            headers=self._github_headers(),
            json=data,
            timeout=(2, 5),
            allow_redirects=False,
        ) as response:
            if response.status_code not in (200, 201):
                raise ValueError("Upload failed")

    def _courier(self, today):
        success = False
        try:
            prefix = f"inputs/ipcet/{today}/"
            status, _, _ = self._github_read(prefix + "meta.json")
            if status == 200:
                success = True
                return
            if status != 404:
                return
            stamp = date.fromisoformat(today).strftime("%d%m%Y")
            page = None
            for spelling in ("hidrometeorologico", "hidrometereologico"):
                page_url = f"https://tabasco.gob.mx/noticias/semaforo-{spelling}-y-niveles-de-rios-{stamp}"
                status, content, _ = self._read(page_url, 2 * 1024 * 1024)
                if status == 200:
                    page = content
                    break
                if status != 404:
                    return
            if page is None:
                return
            parser = _ArticleImages()
            parser.feed(page.decode("utf-8"))
            urls = []
            names = set()
            for src in parser.urls:
                url = urljoin(page_url, src)
                parsed = urlsplit(url)
                if (
                    parsed.scheme != "https"
                    or parsed.netloc != "tabasco.gob.mx"
                    or not parsed.path.startswith("/sites/default/files/")
                ):
                    continue
                url = parsed._replace(query="", fragment="").geturl()
                if url in urls:
                    continue
                name = unquote(parsed.path.rsplit("/", 1)[-1])
                if (
                    not _is_safe_file_name(name)
                    or name in {"page.html", "meta.json"}
                    or name in names
                ):
                    raise ValueError("Ambiguous image name")
                names.add(name)
                urls.append(url)
            if not urls or len(urls) > 30:
                return
            fetched_at = self.now().isoformat()
            images, bodies = [], []
            total = 0
            for url in urls:
                status, body, headers = self._read(url, 8 * 1024 * 1024)
                modified = headers.get("Last-Modified", "")
                if (
                    status != 200
                    or not modified
                    or parsedate_to_datetime(modified).tzinfo is None
                ):
                    return
                total += len(body)
                if total > 20 * 1024 * 1024:
                    return
                images.append(
                    {
                        "url": url,
                        "last_modified": modified,
                        "sha256": hashlib.sha256(body).hexdigest(),
                        "bytes": len(body),
                    }
                )
                bodies.append(body)
            self._upload(prefix + "page.html", page)
            for url, body in zip(urls, bodies, strict=True):
                self._upload(
                    prefix + unquote(urlsplit(url).path.rsplit("/", 1)[-1]), body
                )
            self._upload(
                prefix + "meta.json",
                json.dumps(
                    {
                        "page_url": page_url,
                        "fetched_at": fetched_at,
                        "images": images,
                    },
                    ensure_ascii=False,
                ).encode("utf-8"),
            )
            success = True
        except (
            requests.RequestException,
            OSError,
            ValueError,
            TypeError,
            KeyError,
            AttributeError,
            OverflowError,
        ):
            pass
        finally:
            with self.lock:
                if success:
                    self.success_dates.add(today)
                    self.pending_since = self.now()
                self.inflight = False
