#!/usr/bin/env python3
"""Continuously poll & save live Zalo QR. Opens once, auto-refreshes."""
import urllib.request, subprocess, time, os

ACCOUNT = "personal"
OUT = os.path.expanduser("~/Desktop/zalo-qr-personal.png")
BASE = "http://127.0.0.1:8786"

# Trigger login once
urllib.request.urlopen(urllib.request.Request(
    f"{BASE}/accounts/{ACCOUNT}/login", method="POST", data=b"{}"
))
print(f"Login triggered. Polling QR every 1s — scan when you see it...")

last_saved = None
opened = False
for i in range(120):
    try:
        r = urllib.request.urlopen(f"{BASE}/qr/{ACCOUNT}.png", timeout=1)
        if r.headers.get("Content-Type") == "image/png":
            data = r.read()
            if data != last_saved:
                with open(OUT, "wb") as f:
                    f.write(data)
                last_saved = data
                if not opened:
                    subprocess.run(["open", OUT])
                    opened = True
                print(f"[{i}s] QR updated — scan now!")
    except:
        pass
    time.sleep(1)
print("Done. Run again if needed.")
