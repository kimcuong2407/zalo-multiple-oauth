#!/usr/bin/env python3
"""
zalo_multi.py — Python client for zalo-multi-bridge HTTP API.
Designed to be called by Hermes Agent to read Zalo messages from multiple accounts.

Usage examples:
  python3 zalo_multi.py health
  python3 zalo_multi.py accounts
  python3 zalo_multi.py messages
  python3 zalo_multi.py messages <account_id>
  python3 zalo_multi.py history <account_id> <thread_id>
  python3 zalo_multi.py sync <account_id> <group_id> [count]   # đồng bộ N (mặc định 200) tin mới nhất của 1 group
  python3 zalo_multi.py send <account_id> <thread_id> "<text>"
"""

import sys
import json
import urllib.request
import urllib.error

BASE_URL = "http://127.0.0.1:8786"


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
        except:
            return {"error": str(e), "status": e.code}
    except Exception as e:
        return {"error": str(e)}


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 zalo_multi.py <command> [args...]")
        print("Commands: health, accounts, messages, history, send")
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "health":
        print(json.dumps(api("/health"), indent=2, ensure_ascii=False))

    elif cmd == "accounts":
        result = api("/accounts")
        print(json.dumps(result, indent=2, ensure_ascii=False))

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

    elif cmd == "sync":
        if len(sys.argv) < 4:
            print("Usage: python3 zalo_multi.py sync <account_id> <group_id> [count]")
            sys.exit(1)
        count = sys.argv[4] if len(sys.argv) > 4 else "200"
        result = api(
            f"/accounts/{sys.argv[2]}/sync/{sys.argv[3]}?count={count}",
            method="POST",
        )
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

    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)


if __name__ == "__main__":
    main()
