import json
from pathlib import Path

from strix.interface.viewer.server import resolve_run_dir

def _make_run(base: Path, name: str, *, severity: str = "high") -> Path:
    run_dir = base / "strix_runs" / name
    run_dir.mkdir(parents=True)
    record = {
        "run_name": name,
        "targets_info": [{"original": f"https://{name}.example.com"}],
        "scan_mode": "deep",
        "status": "completed",
        "start_time": "2026-01-01T00:00:00Z",
        "end_time": "2026-01-01T00:10:00Z",
    }
    (run_dir / "run.json").write_text(json.dumps(record), encoding="utf-8")
    (run_dir / "vulnerabilities.json").write_text(
        json.dumps([{"title": "v", "severity": severity}]), encoding="utf-8"
    )
    return run_dir


def test_resolve_run_dir_defaults_when_absent(tmp_path: Path) -> None:
    base = tmp_path / "strix_runs"
    default = _make_run(tmp_path, "alpha")
    assert resolve_run_dir(base, None, default) == default
    assert resolve_run_dir(base, "", default) == default


def test_resolve_run_dir_valid_named_run(tmp_path: Path) -> None:
    base = tmp_path / "strix_runs"
    default = _make_run(tmp_path, "alpha")
    other = _make_run(tmp_path, "beta")
    assert resolve_run_dir(base, "beta", default) == other


def test_resolve_run_dir_rejects_unknown_and_traversal(tmp_path: Path) -> None:
    base = tmp_path / "strix_runs"
    default = _make_run(tmp_path, "alpha")
    secret = tmp_path / "secret"
    secret.mkdir()
    (secret / "run.json").write_text("{}", encoding="utf-8")

    assert resolve_run_dir(base, "nope", default) is None
    assert resolve_run_dir(base, "../secret", default) is None
    assert resolve_run_dir(base, "../../etc", default) is None
