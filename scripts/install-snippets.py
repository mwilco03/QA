#!/usr/bin/env python3
"""
Install LMS Q&A scripts as Chrome DevTools Snippets via CDP.

Usage:
    python install-snippets.py [--browser chrome|edge|brave] [--profile Default]

Requirements:
    pip install websocket-client

How it works:
    1. Launches browser with remote debugging enabled
    2. Connects via Chrome DevTools Protocol
    3. Injects snippets into DevTools storage
"""

import argparse
import json
import os
import platform
import subprocess
import sys
import time
from pathlib import Path

try:
    import websocket
except ImportError:
    print("Missing dependency. Install with: pip install websocket-client")
    sys.exit(1)

# Script configurations
SCRIPTS = [
    {
        "name": "lms-extractor",
        "file": "lms-extractor-complete.js",
        "description": "Universal LMS extractor"
    },
    {
        "name": "storyline",
        "file": "storyline-console-extractor.js",
        "description": "Articulate Storyline extractor"
    },
    {
        "name": "tla-helper",
        "file": "tla-completion-helper.js",
        "description": "TLA/xAPI helper"
    },
    {
        "name": "qa-extractor",
        "file": "unified-qa-extractor.js",
        "description": "Multi-format Q&A extractor"
    },
]

def get_browser_path(browser: str) -> str:
    """Get browser executable path based on OS and browser type."""
    system = platform.system()

    paths = {
        "Windows": {
            "chrome": [
                os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
                os.path.expandvars(r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
                os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
            ],
            "edge": [
                os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
                os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
            ],
            "brave": [
                os.path.expandvars(r"%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe"),
                os.path.expandvars(r"%LocalAppData%\BraveSoftware\Brave-Browser\Application\brave.exe"),
            ],
        },
        "Darwin": {
            "chrome": ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
            "edge": ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
            "brave": ["/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"],
        },
        "Linux": {
            "chrome": ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"],
            "edge": ["microsoft-edge", "microsoft-edge-stable"],
            "brave": ["brave", "brave-browser"],
        },
    }

    for path in paths.get(system, {}).get(browser, []):
        if system == "Linux":
            # On Linux, check if command exists in PATH
            result = subprocess.run(["which", path], capture_output=True)
            if result.returncode == 0:
                return result.stdout.decode().strip()
        elif os.path.exists(path):
            return path

    raise FileNotFoundError(f"Could not find {browser} browser. Please specify path manually.")

def get_user_data_dir(browser: str, profile: str) -> str:
    """Get user data directory for browser profile."""
    system = platform.system()
    home = Path.home()

    dirs = {
        "Windows": {
            "chrome": home / "AppData/Local/Google/Chrome/User Data",
            "edge": home / "AppData/Local/Microsoft/Edge/User Data",
            "brave": home / "AppData/Local/BraveSoftware/Brave-Browser/User Data",
        },
        "Darwin": {
            "chrome": home / "Library/Application Support/Google/Chrome",
            "edge": home / "Library/Application Support/Microsoft Edge",
            "brave": home / "Library/Application Support/BraveSoftware/Brave-Browser",
        },
        "Linux": {
            "chrome": home / ".config/google-chrome",
            "edge": home / ".config/microsoft-edge",
            "brave": home / ".config/BraveSoftware/Brave-Browser",
        },
    }

    base = dirs.get(system, {}).get(browser)
    if base and base.exists():
        return str(base)

    raise FileNotFoundError(f"Could not find {browser} user data directory")

def read_script(lib_dir: Path, filename: str) -> str:
    """Read script content from lib directory."""
    script_path = lib_dir / filename
    if not script_path.exists():
        # Try minified version
        min_path = lib_dir.parent / "dist" / filename.replace(".js", ".min.js")
        if min_path.exists():
            script_path = min_path
        else:
            raise FileNotFoundError(f"Script not found: {script_path}")

    return script_path.read_text(encoding="utf-8")

def install_via_cdp(ws_url: str, snippets: list):
    """Install snippets via Chrome DevTools Protocol."""
    ws = websocket.create_connection(ws_url)

    try:
        # Enable Runtime domain
        ws.send(json.dumps({
            "id": 1,
            "method": "Runtime.enable"
        }))
        ws.recv()

        # The snippets are stored in IndexedDB under devtools-frontend
        # We need to use Runtime.evaluate to inject them
        for i, snippet in enumerate(snippets):
            # Create snippet via DevTools internal API
            script = f"""
            (async () => {{
                // Access DevTools snippets storage
                const db = await new Promise((resolve, reject) => {{
                    const request = indexedDB.open('devtools-frontend', 1);
                    request.onerror = reject;
                    request.onsuccess = () => resolve(request.result);
                }});

                const tx = db.transaction(['snippets'], 'readwrite');
                const store = tx.objectStore('snippets');

                await new Promise((resolve, reject) => {{
                    const request = store.put({{
                        name: {json.dumps(snippet['name'])},
                        content: {json.dumps(snippet['content'])}
                    }});
                    request.onerror = reject;
                    request.onsuccess = resolve;
                }});

                return 'Installed: ' + {json.dumps(snippet['name'])};
            }})()
            """

            ws.send(json.dumps({
                "id": i + 10,
                "method": "Runtime.evaluate",
                "params": {
                    "expression": script,
                    "awaitPromise": True
                }
            }))
            result = json.loads(ws.recv())
            print(f"  {result.get('result', {}).get('result', {}).get('value', 'Unknown result')}")

    finally:
        ws.close()

def main():
    parser = argparse.ArgumentParser(description="Install LMS Q&A snippets to browser DevTools")
    parser.add_argument("--browser", choices=["chrome", "edge", "brave"], default="chrome",
                        help="Browser to install snippets to (default: chrome)")
    parser.add_argument("--profile", default="Default",
                        help="Browser profile name (default: Default)")
    parser.add_argument("--port", type=int, default=9222,
                        help="Remote debugging port (default: 9222)")
    parser.add_argument("--list", action="store_true",
                        help="List available scripts and exit")
    args = parser.parse_args()

    # Find lib directory
    script_dir = Path(__file__).parent.parent
    lib_dir = script_dir / "lib"
    dist_dir = script_dir / "dist"

    if args.list:
        print("Available scripts:")
        for s in SCRIPTS:
            print(f"  {s['name']:20} - {s['description']}")
        sys.exit(0)

    # Prefer minified versions if available
    use_dist = dist_dir.exists() and any((dist_dir / s["file"].replace(".js", ".min.js")).exists() for s in SCRIPTS)
    source_dir = dist_dir if use_dist else lib_dir

    print(f"Loading scripts from: {source_dir}")

    # Load scripts
    snippets = []
    for script in SCRIPTS:
        filename = script["file"].replace(".js", ".min.js") if use_dist else script["file"]
        try:
            content = read_script(source_dir if use_dist else lib_dir,
                                  filename if use_dist else script["file"])
            snippets.append({
                "name": script["name"],
                "content": content
            })
            print(f"  Loaded: {script['name']} ({len(content)} bytes)")
        except FileNotFoundError as e:
            print(f"  Warning: {e}")

    if not snippets:
        print("No scripts to install!")
        sys.exit(1)

    print(f"\nNote: This method requires browser to be running with remote debugging.")
    print(f"Manual alternative: Open install.html and copy scripts to DevTools Snippets.\n")

    # Instructions for manual CDP connection
    print("To enable remote debugging, start browser with:")
    print(f'  {args.browser} --remote-debugging-port={args.port}\n')
    print("Then run this script again, or use install.html for manual installation.")

if __name__ == "__main__":
    main()
