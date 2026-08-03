#!/usr/bin/env python3
"""
zalo_multi.py — Python client for zalo-multi-bridge HTTP API.
Reads Zalo messages from multiple accounts through the bridge server.

Usage examples:
  python3 zalo_multi.py health
  python3 zalo_multi.py accounts
  python3 zalo_multi.py messages
  python3 zalo_multi.py messages <account_id>
  python3 zalo_multi.py history <account_id> <thread_id>
  python3 zalo_multi.py conversations <account_id>
  python3 zalo_multi.py friends <account_id>
  python3 zalo_multi.py groups <account_id>
  python3 zalo_multi.py send <account_id> <thread_id> "<text>"
  python3 zalo_multi.py login <account_id>
  python3 zalo_multi.py logout <account_id>
  python3 zalo_multi.py backfill <account_id> [wait_seconds]

Environment variables:
  ZALO_MULTI_BASE_URL — bridge base URL (default http://127.0.0.1:8786)
"""

import os
import sys
import json
import urllib.request
import urllib.error

BASE_URL = os.environ.get("ZALO_MULTI_BASE_URL", "http://127.0.0.1:8786").rstrip("/")


def api(path, method="GET", data=None):
    """Make an HTTP request to the zalo-multi-bridge API."""
    url = f"{BASE_URL}{path}"
    req = urllib.request.Request(url, method=method)
    req.add_header("Content-Type", "application/json")

    if data:
        req.data = json.dumps(data).encode("utf-8")

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode("utf-8"))
        except Exception:
            return {"error": str(e), "status": e.code}
    except ConnectionRefusedError:
        return {
            "error": f"Cannot connect to {BASE_URL}. Is the bridge running?",
        }
    except Exception as e:
        return {"error": str(e)}


COMMANDS = [
    "health", "accounts", "messages", "history", "conversations",
    "friends", "groups", "send", "login", "logout", "backfill",
]


def main():
    if len(sys.argv) < 2:
        print(f"Usage: python3 zalo_multi.py <command> [args...]")
        print(f"Commands: {', '.join(COMMANDS)}")
        sys.exit(1)

    cmd = sys.argv[1]
    if cmd not in COMMANDS:
        print(f"Unknown command: {cmd}")
        print(f"Available: {', '.join(COMMANDS)}")
        sys.exit(1)

    if cmd == "health":
        print(json.dumps(api("/health"), indent=2, ensure_ascii=False))

    elif cmd == "accounts":
        print(json.dumps(api("/accounts"), indent=2, ensure_ascii=False))

    elif cmd == "messages":
        account_id = sys.argv[2] if len(sys.argv) > 2 else None
        if account_id:
            result = api(f"/accounts/{account_id}/messages")
        else:
            result = api("/messages")
        print(json.dumps(result, indent=2, ensure_ascii=False))

    elif cmd == "history":
        if len(sys.argv) < 4:
            print("Usage: python3 zalo_multi.py history <account_id> <thread_id>")
            sys.exit(1)
        result = api(f"/accounts/{sys.argv[2]}/history/{sys.argv[3]}")
        print(json.dumps(result, indent=2, ensure_ascii=False))

    elif cmd == "conversations":
        if len(sys.argv) < 3:
            print("Usage: python3 zalo_multi.py conversations <account_id>")
            sys.exit(1)
        result = api(f"/accounts/{sys.argv[2]}/conversations")
        print(json.dumps(result, indent=2, ensure_ascii=False))

    elif cmd == "friends":
        if len(sys.argv) < 3:
            print("Usage: python3 zalo_multi.py friends <account_id>")
            sys.exit(1)
        result = api(f"/accounts/{sys.argv[2]}/friends")
        print(json.dumps(result, indent=2, ensure_ascii=False))

    elif cmd == "groups":
        if len(sys.argv) < 3:
            print("Usage: python3 zalo_multi.py groups <account_id>")
            sys.exit(1)
        result = api(f"/accounts/{sys.argv[2]}/groups")
        print(json.dumps(result, indent=2, ensure_ascii=False))

    elif cmd == "send":
        if len(sys.argv) < 5:
            print("Usage: python3 zalo_multi.py send <account_id> <thread_id> <text>")
            sys.exit(1)
        result = api(
            f"/accounts/{sys.argv[2]}/send",
            method="POST",
            data={"threadId": sys.argv[3], "text": sys.argv[4]},
        )
        print(json.dumps(result, indent=2, ensure_ascii=False))

    elif cmd == "login":
        if len(sys.argv) < 3:
            print("Usage: python3 zalo_multi.py login <account_id>")
            sys.exit(1)
        result = api(f"/accounts/{sys.argv[2]}/login", method="POST")
        print(json.dumps(result, indent=2, ensure_ascii=False))

    elif cmd == "logout":
        if len(sys.argv) < 3:
            print("Usage: python3 zalo_multi.py logout <account_id>")
            sys.exit(1)
        result = api(f"/accounts/{sys.argv[2]}/logout", method="POST")
        print(json.dumps(result, indent=2, ensure_ascii=False))

    elif cmd == "backfill":
        if len(sys.argv) < 3:
            print("Usage: python3 zalo_multi.py backfill <account_id> [wait_seconds]")
            sys.exit(1)
        wait_seconds = int(sys.argv[3]) if len(sys.argv) > 3 else 8
        wait_ms = wait_seconds * 1000
        result = api(
            f"/accounts/{sys.argv[2]}/backfill?wait={wait_ms}",
            method="POST",
        )
        print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
