"""
Comprueba de dónde salen las credenciales de Earth Engine y qué token se obtiene.

Nota: https://www.googleapis.com/oauth2/v3/userinfo suele devolver 401 con el
token de `earthengine authenticate` porque ese flujo no pide el alcance
openid/userinfo.email. No es señal de cuenta incorrecta.
"""

import json
import os
import urllib.parse
import urllib.request
from pathlib import Path

import google.auth.transport.requests

ee_path = Path.home() / ".config/earthengine/credentials"
adc_path = Path.home() / ".config/gcloud/application_default_credentials.json"

print("GOOGLE_APPLICATION_CREDENTIALS:", os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "(no definida)"))
print("EE credentials file exists:", ee_path.is_file(), "->", ee_path)
if ee_path.is_file():
    d = json.loads(ee_path.read_text())
    print("  keys in file:", sorted(d.keys()))
    print("  project in file (cuota / hint):", d.get("project", "(no viene — opcional: earthengine set_project TU_ID)"))
    print("  has refresh_token:", bool(d.get("refresh_token")))
    if d.get("scopes"):
        print("  scopes en archivo:", d.get("scopes"))

print("ADC file exists:", adc_path.is_file(), "->", adc_path)

import ee
from ee import data as ee_data

creds = ee_data.get_persistent_credentials()
req = google.auth.transport.requests.Request()
creds.refresh(req)
print("\nResolved credential type:", type(creds).__name__)
print("quota_project_id on credentials:", getattr(creds, "quota_project_id", None))
print("scopes en objeto Credentials:", getattr(creds, "scopes", None))

# tokeninfo acepta access tokens de muchos flujos OAuth y devuelve scope, aud, a veces email/sub
if creds.token:
    url = "https://oauth2.googleapis.com/tokeninfo?" + urllib.parse.urlencode({"access_token": creds.token})
    try:
        raw = urllib.request.urlopen(url, timeout=30).read().decode()
        info = json.loads(raw)
        if "error" in info:
            print("\ntokeninfo:", info)
        else:
            print("\ntokeninfo (válido):")
            for key in ("email", "sub", "user_id", "aud", "scope", "expires_in"):
                if key in info:
                    print(f"  {key}: {info[key]}")
            if "email" not in info and "sub" not in info:
                print("  (sin email/sub en tokeninfo — normal para algunos alcances de EE)")
    except urllib.error.HTTPError as e:
        print("\ntokeninfo HTTP error:", e.code, e.read().decode(errors="replace")[:500])

# userinfo solo funciona si el token incluye alcance de perfil (EE no lo pide por defecto)
try:
    r = urllib.request.Request(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        headers={"Authorization": f"Bearer {creds.token}"},
    )
    info = json.loads(urllib.request.urlopen(r, timeout=30).read().decode())
    print("\nuserinfo email:", info.get("email"))
except Exception as e:
    print("\nuserinfo:", e, "(esperado si el token no trae alcance openid/userinfo.email)")
