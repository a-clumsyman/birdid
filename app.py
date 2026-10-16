import hashlib
import os
import subprocess
from datetime import datetime, timezone

import httpx
import numpy as np
from birdnetlib import RecordingBuffer
from birdnetlib.analyzer import Analyzer
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
analyzer = Analyzer()
MAX_BYTES = 8_000_000
SB_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SB_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
INGEST_MIN_CONF = float(os.environ.get("INGEST_MIN_CONF", "0.5"))
MIN_ISOLATION = float(os.environ.get("MIN_ISOLATION", "0.6"))


def decode(data: bytes):
    p = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", "pipe:0", "-t", "30", "-ar", "48000", "-ac", "1", "-f", "s16le", "pipe:1"],
        input=data, capture_output=True)
    if p.returncode != 0 or not p.stdout:
        return None
    return np.frombuffer(p.stdout, dtype="int16").astype("float32") / 32768.0


def analyze(buf, lat, lon, min_conf):
    kw = {"lat": lat, "lon": lon} if lat is not None and lon is not None else {}
    rec = RecordingBuffer(analyzer, buf, 48000, min_conf=min_conf, **kw)
    rec.analyze()
    best = {}
    for d in rec.detections:
        k = d["scientific_name"]
        if k not in best or d["confidence"] > best[k]["confidence"]:
            best[k] = {"common_name": d["common_name"], "scientific_name": k, "confidence": round(d["confidence"], 3)}
    return sorted(best.values(), key=lambda d: -d["confidence"])


@app.get("/")
def health():
    return {"ok": True, "ingest": bool(SB_URL and SB_KEY)}


@app.post("/identify")
async def identify(file: UploadFile = File(...), lat: float = Form(None), lon: float = Form(None), min_conf: float = Form(0.25)):
    data = await file.read()
    if len(data) > MAX_BYTES:
        return {"error": "too large", "detections": []}
    buf = decode(data)
    if buf is None:
        return {"error": "could not decode audio", "detections": []}
    return {"detections": analyze(buf, lat, lon, min_conf)}


def sb_headers(extra=None):
    h = {"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"}
    h.update(extra or {})
    return h


@app.post("/ingest")
async def ingest(
    file: UploadFile = File(...),
    device_key: str = Form(...),
    isolated: bool = Form(False),
    isolation_score: float = Form(None),
    lat: float = Form(None),
    lon: float = Form(None),
    place_name: str = Form(None),
    habitat: str = Form(None),
    recorded_at: str = Form(None),
):
    """Device path: a 24/7 recorder posts a clip it has already isolated as a bird call.
    Stored only if the device says it is isolated, the score passes the gate, and BirdNET confirms a species."""
    if not (SB_URL and SB_KEY):
        return {"stored": False, "reason": "ingest_not_configured"}
    if not isolated or (isolation_score is not None and isolation_score < MIN_ISOLATION):
        return {"stored": False, "reason": "not_isolated"}
    data = await file.read()
    if len(data) > MAX_BYTES:
        return {"stored": False, "reason": "too_large"}
    key_hash = hashlib.sha256(device_key.encode()).hexdigest()
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(f"{SB_URL}/rest/v1/devices", params={"key_hash": f"eq.{key_hash}", "select": "id,user_id"}, headers=sb_headers())
        rows = r.json() if r.status_code == 200 else []
        if not rows:
            return {"stored": False, "reason": "unknown_device"}
        dev = rows[0]
        buf = decode(data)
        if buf is None:
            return {"stored": False, "reason": "could_not_decode"}
        dets = [d for d in analyze(buf, lat, lon, INGEST_MIN_CONF)]
        if not dets:
            return {"stored": False, "reason": "no_species_above_threshold"}
        ts = recorded_at or datetime.now(timezone.utc).isoformat()
        ext = (file.filename or "clip.webm").rsplit(".", 1)[-1].lower()
        ctype = file.content_type or "audio/webm"
        path = f"{dev['user_id']}/{dev['id']}/{int(datetime.now(timezone.utc).timestamp()*1000)}.{ext}"
        up = await c.post(f"{SB_URL}/storage/v1/object/recordings/{path}", content=data, headers=sb_headers({"Content-Type": ctype}))
        if up.status_code >= 300:
            return {"stored": False, "reason": "storage_error", "detail": up.text[:200]}
        dur = round(len(buf) / 48000, 2)
        rowsout = [{
            "user_id": dev["user_id"], "device_id": dev["id"], "source": "device",
            "species_common": d["common_name"], "species_scientific": d["scientific_name"], "confidence": d["confidence"],
            "observed_at": ts, "lat": lat, "lon": lon, "place_name": place_name,
            "habitat": habitat if habitat in ("garden", "park", "forest", "water", "urban", "farm") else None,
            "audio_path": path, "audio_duration_s": dur, "isolation_score": isolation_score,
        } for d in dets[:3]]
        ins = await c.post(f"{SB_URL}/rest/v1/observations", json=rowsout, headers=sb_headers({"Prefer": "return=minimal"}))
        if ins.status_code >= 300:
            return {"stored": False, "reason": "db_error", "detail": ins.text[:200]}
        await c.patch(f"{SB_URL}/rest/v1/devices", params={"id": f"eq.{dev['id']}"}, json={"last_seen_at": ts}, headers=sb_headers())
    return {"stored": True, "species": dets[:3], "audio_path": path}
