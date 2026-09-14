"""Detached local source preparation; upstream refresh is intentionally unavailable."""
from pathlib import Path
from .config import SOURCE_FILES

def download_files():
    """Retain CLI compatibility without replacing locally customized source."""
    source = Path(__file__).resolve().parents[1] / "swisseph"
    missing = [name for name in SOURCE_FILES if not (source / name).is_file()]
    if missing:
        raise FileNotFoundError("Missing vendored source: " + ", ".join(missing))
    print("Using detached local Swiss Ephemeris source: " + str(source))
