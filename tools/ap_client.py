#!/usr/bin/env python3
"""Autopilot Bridge client: key generation, connection codes and signed API calls.

  ap_client.py keygen                         -> prints AP_SIGNING_KEY (secret) + public key + key id
  ap_client.py code <site_id>                 -> connection code to paste in wp-admin (needs AP_SIGNING_KEY)
  ap_client.py call <site_url> <route> [json] -> signed POST, prints JSON response

Env: AP_SIGNING_KEY (base64 Ed25519 seed, 32 bytes), AP_KEY_ID.
Requires: pip install pynacl requests
"""
import base64, hashlib, json, os, secrets, sys, time

import requests
from nacl.signing import SigningKey

NS = "/autopilot/v1"


def _key():
    seed = os.environ.get("AP_SIGNING_KEY")
    if not seed:
        sys.exit("AP_SIGNING_KEY is not set")
    return SigningKey(base64.b64decode(seed))


def key_id():
    return os.environ.get("AP_KEY_ID", "hub-1")


def connection_code(site_id, hub="WP Autopilot"):
    pk = base64.b64encode(bytes(_key().verify_key)).decode()
    data = {"v": 1, "site_id": site_id, "key_id": key_id(), "public_key": pk, "hub": hub}
    return base64.b64encode(json.dumps(data, separators=(",", ":")).encode()).decode()


def call(site_url, route, body=None, timeout=60, pretty_permalinks=True):
    route = route if route.startswith(NS) else f"{NS}/{route.lstrip('/')}"
    raw = json.dumps(body or {}, separators=(",", ":")).encode()
    ts, nonce = str(int(time.time())), secrets.token_urlsafe(24)
    msg = "\n".join(["POST", route, ts, nonce, hashlib.sha256(raw).hexdigest()]).encode()
    sig = base64.b64encode(_key().sign(msg).signature).decode()
    base = site_url.rstrip("/")
    url = f"{base}/wp-json{route}" if pretty_permalinks else f"{base}/?rest_route={route}"
    r = requests.post(url, data=raw, timeout=timeout, headers={
        "Content-Type": "application/json",
        "X-AP-Key-Id": key_id(), "X-AP-Timestamp": ts, "X-AP-Nonce": nonce, "X-AP-Signature": sig,
        "User-Agent": "wp-autopilot/0.1",
    })
    try:
        data = r.json()
    except ValueError:
        data = {"raw": r.text[:500]}
    return r.status_code, data


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "keygen":
        sk = SigningKey.generate()
        print("AP_SIGNING_KEY=" + base64.b64encode(bytes(sk)).decode())
        print("AP_PUBLIC_KEY=" + base64.b64encode(bytes(sk.verify_key)).decode())
        print("AP_KEY_ID=hub-" + secrets.token_hex(3))
    elif cmd == "code" and len(sys.argv) >= 3:
        print(connection_code(sys.argv[2]))
    elif cmd == "call" and len(sys.argv) >= 4:
        body = json.loads(sys.argv[4]) if len(sys.argv) > 4 else {}
        status, data = call(sys.argv[2], sys.argv[3], body,
                            pretty_permalinks=os.environ.get("AP_PRETTY", "1") == "1")
        print(status)
        print(json.dumps(data, indent=2)[:20000])
        sys.exit(0 if status < 400 else 1)
    else:
        print(__doc__)
