"""Publishing a JSON bundle must never expose a partially-written file.

The bundles are served straight off disk to the dev server and the browser, so a
truncate-then-write publish let a reader land mid-write and receive unparseable
JSON. In the UI that surfaced as "data unavailable"; measured against the 416 KB
projections bundle, ~8% of concurrent reads failed.
"""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path

from pipeline.publish import write_json


def _payload(n: int = 4000) -> dict[str, object]:
    """Big enough that a non-atomic write has a real window to be caught in."""
    return {"players": {str(i): {"web_name": f"Player {i}", "xp": i / 7} for i in range(n)}}


def test_write_json_round_trips(tmp_path: Path) -> None:
    target = tmp_path / "bundle.json"
    obj = _payload(10)
    write_json(target, obj)
    assert json.loads(target.read_text(encoding="utf-8")) == obj


def test_write_json_leaves_no_temp_files(tmp_path: Path) -> None:
    target = tmp_path / "bundle.json"
    for _ in range(3):
        write_json(target, _payload(10))
    assert [p.name for p in tmp_path.iterdir()] == ["bundle.json"]


def test_concurrent_reader_never_sees_a_partial_bundle(tmp_path: Path) -> None:
    """Rewrite repeatedly while a reader hammers the same path.

    A reader may briefly fail to OPEN the file (Windows locks it during the
    atomic swap), which is benign and retried by the client. What must never
    happen is a successful read of invalid JSON — that is data corruption.
    """
    target = tmp_path / "bundle.json"
    obj = _payload()
    write_json(target, obj)

    corrupt = 0
    reads = 0
    done = threading.Event()

    def reader() -> None:
        nonlocal corrupt, reads
        while not done.is_set():
            reads += 1
            try:
                json.loads(target.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                corrupt += 1
            except OSError:
                pass  # transient lock during the swap; the file is never wrong
            time.sleep(0.001)

    thread = threading.Thread(target=reader, daemon=True)
    thread.start()
    try:
        for _ in range(15):
            write_json(target, obj)
            time.sleep(0.01)
    finally:
        done.set()
        thread.join(timeout=5)

    assert reads > 0, "reader never ran, so the test proved nothing"
    assert corrupt == 0, f"{corrupt} of {reads} reads saw a partially-written bundle"
