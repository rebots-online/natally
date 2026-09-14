#!/usr/bin/env python3
"""Materialize the pinned upstream ephemeris repositories and published runtime."""

import base64
import hashlib
import json
import pathlib
import subprocess
import tarfile
import urllib.request
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEST = ROOT / "VENDORED" / "sweph-wasm"
CACHE = pathlib.Path.home() / "outbox" / "natally" / "upstream-archives"
VERSION = "2.6.9"
WRAPPER_COMMIT = "0583463e4c4f4791e19f2a9f1962d2d965e021ab"
ENGINE_COMMIT = "fa78b5065810fa9077e96475e33decb8f3ecd61c"
INTEGRITY = "SNM+XiujTAlgyU07M7onZWYNk/XsFmaWWm9QphMRkaNzXVMx9sRLBzxs7ubO9kBbXEPgJSm2SP/xyzOZ8Vp1mA=="


def digest(path, algorithm="sha256"):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, algorithm).digest()


def download(name, url):
    CACHE.mkdir(parents=True, exist_ok=True)
    archive = CACHE / name
    if not archive.exists():
        partial = archive.with_suffix(archive.suffix + ".partial")
        request = urllib.request.Request(url, headers={"User-Agent": "natally-vendoring"})
        with urllib.request.urlopen(request, timeout=60) as response, partial.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        partial.rename(archive)
    print(f"Archive ready: {archive.name} ({archive.stat().st_size} bytes)", flush=True)
    return archive


def extract(archive, destination, published=False):
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, "r:gz") as source:
        for member in source:
            parts = pathlib.PurePosixPath(member.name).parts[1:]
            if not parts:
                continue
            # The source snapshot remains verbatim. Only the published runtime is overlaid.
            if published and parts[0] != "dist":
                continue
            member.name = str(pathlib.PurePosixPath(*parts))
            source.extract(member, path=destination, filter="data")


def main():
    manifest = DEST.parent / "ephemeris-manifest.json"
    if manifest.exists():
        print(f"Detached local source already exists at {DEST}; leaving all customizations intact")
        return
    if DEST.exists():
        raise SystemExit(f"Preserve existing {DEST} before materializing a new snapshot")

    wrapper = download(f"sweph-wasm-{VERSION}-{WRAPPER_COMMIT}.tar.gz",
                       f"https://codeload.github.com/ptprashanttripathi/sweph-wasm/tar.gz/{WRAPPER_COMMIT}")
    engine = download(f"swisseph-{ENGINE_COMMIT}.tar.gz",
                      f"https://codeload.github.com/aloistr/swisseph/tar.gz/{ENGINE_COMMIT}")
    runtime = download(f"sweph-wasm-{VERSION}-npm.tgz",
                       f"https://registry.npmjs.org/sweph-wasm/-/sweph-wasm-{VERSION}.tgz")
    if base64.b64encode(digest(runtime, "sha512")).decode() != INTEGRITY:
        raise SystemExit("Published runtime does not match the pinned npm SHA-512 integrity")
    extract(wrapper, DEST)
    extract(engine, DEST / "swisseph")
    extract(runtime, DEST, published=True)
    # Record original bytes before applying natally's separately preserved customizations.
    records = [{"path": str(path.relative_to(DEST.parent)), "bytes": path.stat().st_size,
                "sha256": digest(path).hex()}
               for path in sorted(DEST.rglob("*")) if path.is_file()]
    metadata = {
        "retrievedAt": datetime.now(timezone.utc).isoformat(),
        "wrapper": {"repository": "https://github.com/ptprashanttripathi/sweph-wasm",
                    "version": VERSION, "commit": WRAPPER_COMMIT},
        "engine": {"repository": "https://github.com/aloistr/swisseph", "commit": ENGINE_COMMIT},
        "runtime": {"version": VERSION, "integrity": "sha512-" + INTEGRITY},
        "archives": [{"name": archive.name, "sha256": digest(archive).hex()}
                     for archive in [wrapper, engine, runtime]],
        "files": records,
    }
    # Assimilate as ordinary source and remove the build-time upstream refresh path.
    patch = DEST.parent / "patches" / "sweph-wasm-2.6.9-detach.patch"
    subprocess.run(["patch", "--batch", "--forward", "-p1"], cwd=DEST,
                   input=patch.read_text(), text=True, check=True)
    (DEST / ".gitmodules").rename(DEST / "UPSTREAM-SUBMODULES.txt")
    manifest.write_text(json.dumps(metadata, indent=2) + "\n")
    print(f"Vendored {len(records)} files under {DEST}", flush=True)


if __name__ == "__main__":
    main()
