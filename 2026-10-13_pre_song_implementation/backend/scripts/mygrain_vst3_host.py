#!/usr/bin/env python3
"""Offline MYGRAIN VST3 render host.

This is intentionally a local command-line tool, not a public web endpoint.
VST3 plugins are native code and licensed plugins may need a desktop/session
licence prompt, so expose them to MYGRAIN only after the exact plugin is known.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import sys
import time
from typing import Any


MYGRAIN_BASTARDLOOPS_ROOT = pathlib.Path(
    os.environ.get("MYGRAIN_BASTARDLOOPS_ROOT", "/srv/sftp/mark_sftp/files/mygrain-bastardloops")
)
MYGRAIN_VST3_RENDERS_ROOT = pathlib.Path(
    os.environ.get("MYGRAIN_VST3_RENDERS_ROOT", "/srv/sftp/mark_sftp/files/mygrain-vst3-renders")
)
MYGRAIN_VST3_PLUGIN_ROOT = pathlib.Path(
    os.environ.get("MYGRAIN_VST3_PLUGIN_ROOT", "/srv/sftp/mark_sftp/files/mygrain-vst3-plugins")
)


def default_plugin_dirs() -> list[pathlib.Path]:
    values = [
        MYGRAIN_VST3_PLUGIN_ROOT,
        pathlib.Path.home() / ".vst3",
        pathlib.Path("/usr/lib/vst3"),
        pathlib.Path("/usr/local/lib/vst3"),
        pathlib.Path("/Library/Audio/Plug-Ins/VST3"),
        pathlib.Path.home() / "Library/Audio/Plug-Ins/VST3",
        pathlib.Path("C:/Program Files/Common Files/VST3"),
    ]
    extra = os.environ.get("MYGRAIN_VST3_DIRS", "")
    for segment in re.split(r"[:;]", extra):
        if segment.strip():
            values.insert(0, pathlib.Path(segment.strip()).expanduser())
    return values


def sanitize_wav_filename(value: str, fallback: str = "mygrain-vst3-render.wav") -> str:
    name = pathlib.PurePath(str(value or fallback).replace("\\", "/")).name
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("._-")
    if not name:
        name = fallback
    if not name.lower().endswith(".wav"):
        name += ".wav"
    return name


def parse_parameter(value: str) -> tuple[str, Any]:
    if "=" not in value:
        raise argparse.ArgumentTypeError("Plugin parameters must be KEY=VALUE.")
    key, raw_value = value.split("=", 1)
    key = key.strip()
    raw_value = raw_value.strip()
    if not key:
        raise argparse.ArgumentTypeError("Plugin parameter key cannot be empty.")
    lowered = raw_value.lower()
    if lowered in {"true", "yes", "on"}:
        return key, True
    if lowered in {"false", "no", "off"}:
        return key, False
    try:
        if re.fullmatch(r"[-+]?\d+", raw_value):
            return key, int(raw_value)
        return key, float(raw_value)
    except ValueError:
        return key, raw_value


def iter_vst3_plugins(plugin_dirs: list[pathlib.Path] | None = None):
    seen: set[pathlib.Path] = set()
    for root in plugin_dirs or default_plugin_dirs():
        root = root.expanduser()
        if not root.exists():
            continue
        if root.is_file() and root.suffix.lower() == ".vst3":
            resolved = root.resolve()
            if resolved not in seen:
                seen.add(resolved)
                yield resolved
            continue
        for item in sorted(root.rglob("*.vst3")):
            resolved = item.resolve()
            if resolved not in seen:
                seen.add(resolved)
                yield resolved


def plugin_record(path: pathlib.Path) -> dict[str, Any]:
    try:
        stat = path.stat()
        modified = int(stat.st_mtime)
        size = stat.st_size if path.is_file() else None
    except OSError:
        modified = None
        size = None
    return {
        "id": path.stem,
        "name": path.stem,
        "path": str(path),
        "modified": modified,
        "size": size,
    }


def list_plugins(args: argparse.Namespace) -> int:
    dirs = [pathlib.Path(value) for value in args.plugin_dir] if args.plugin_dir else None
    plugins = [plugin_record(path) for path in iter_vst3_plugins(dirs)]
    if args.json:
        print(json.dumps({"ok": True, "plugins": plugins}, indent=2))
        return 0
    if not plugins:
        print("No VST3 plugins found.")
        print("Looked in:")
        for directory in dirs or default_plugin_dirs():
            print(f"  - {directory}")
        return 0
    for index, item in enumerate(plugins, start=1):
        print(f"{index:>2}. {item['name']}")
        print(f"    {item['path']}")
    return 0


def resolve_plugin(value: str, plugin_dirs: list[pathlib.Path] | None = None) -> pathlib.Path:
    if not value:
        raise ValueError("Plugin path or name is required.")
    candidate = pathlib.Path(value).expanduser()
    if candidate.exists() and candidate.suffix.lower() == ".vst3":
        return candidate.resolve()
    normalized = value.strip().casefold()
    matches = []
    for path in iter_vst3_plugins(plugin_dirs):
        names = {path.name.casefold(), path.stem.casefold(), str(path).casefold()}
        if normalized in names:
            matches.append(path)
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        choices = "\n".join(f"  - {match}" for match in matches)
        raise ValueError(f"Plugin name is ambiguous:\n{choices}")
    raise FileNotFoundError(f"VST3 plugin not found: {value}")


def unique_output_path(path: pathlib.Path) -> pathlib.Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        return path
    stem = path.stem
    suffix = path.suffix or ".wav"
    for index in range(1, 10000):
        candidate = path.with_name(f"{stem}-{index}{suffix}")
        if not candidate.exists():
            return candidate
    raise RuntimeError(f"Could not allocate a unique output filename in {path.parent}")


def import_pedalboard():
    try:
        import numpy as np
        from pedalboard import Pedalboard, load_plugin
        from pedalboard.io import AudioFile
    except Exception as exc:  # pragma: no cover - exercised in operator setup
        raise RuntimeError(
            "Missing VST3 host dependency. Run "
            "`scripts/setup_mygrain_vst3_host.sh` or install `pedalboard` in the active Python."
        ) from exc
    return np, Pedalboard, load_plugin, AudioFile


def render_audio(
    *,
    input_path: pathlib.Path,
    output_path: pathlib.Path,
    plugin_path: pathlib.Path | None,
    plugin_name: str | None = None,
    parameters: dict[str, Any] | None = None,
    tail_seconds: float = 0.0,
    buffer_size: int = 8192,
    initialization_timeout: float = 30.0,
    bypass: bool = False,
) -> dict[str, Any]:
    np, Pedalboard, load_plugin, AudioFile = import_pedalboard()
    input_path = input_path.expanduser().resolve()
    if not input_path.exists():
        raise FileNotFoundError(f"Input WAV not found: {input_path}")
    if input_path.suffix.lower() != ".wav":
        raise ValueError("Input must be a WAV file.")

    with AudioFile(str(input_path)) as handle:
        audio = handle.read(handle.frames)
        sample_rate = float(handle.samplerate)
        channels = int(handle.num_channels)

    if tail_seconds > 0:
        tail_frames = int(round(sample_rate * tail_seconds))
        if tail_frames > 0:
            audio = np.concatenate(
                [audio, np.zeros((audio.shape[0], tail_frames), dtype=audio.dtype)],
                axis=1,
            )

    plugin = None
    board = Pedalboard([])
    if not bypass:
        if plugin_path is None:
            raise ValueError("A plugin is required unless --bypass is set.")
        plugin = load_plugin(
            str(plugin_path),
            parameter_values=parameters or {},
            plugin_name=plugin_name,
            initialization_timeout=initialization_timeout,
        )
        if not getattr(plugin, "is_effect", False):
            raise ValueError(f"{plugin_path.name} loaded, but it is not an audio effect.")
        board = Pedalboard([plugin])

    started = time.monotonic()
    processed = board(audio, sample_rate, buffer_size=buffer_size, reset=True)
    elapsed = time.monotonic() - started
    output_path = unique_output_path(output_path.expanduser().resolve())
    with AudioFile(str(output_path), "w", int(round(sample_rate)), processed.shape[0]) as handle:
        handle.write(processed)

    return {
        "ok": True,
        "input": str(input_path),
        "output": str(output_path),
        "plugin": str(plugin_path) if plugin_path else None,
        "pluginName": str(plugin) if plugin is not None else None,
        "sampleRate": int(round(sample_rate)),
        "channels": channels,
        "frames": int(processed.shape[1]),
        "seconds": processed.shape[1] / sample_rate,
        "renderSeconds": elapsed,
        "parameters": parameters or {},
        "bypass": bypass,
    }


def render_file(args: argparse.Namespace) -> int:
    plugin_dirs = [pathlib.Path(value) for value in args.plugin_dir] if args.plugin_dir else None
    plugin_path = None if args.bypass else resolve_plugin(args.plugin, plugin_dirs)
    parameters = dict(args.parameter or [])
    result = render_audio(
        input_path=pathlib.Path(args.input),
        output_path=pathlib.Path(args.output),
        plugin_path=plugin_path,
        plugin_name=args.plugin_name,
        parameters=parameters,
        tail_seconds=args.tail_seconds,
        buffer_size=args.buffer_size,
        initialization_timeout=args.timeout,
        bypass=args.bypass,
    )
    print(json.dumps(result, indent=2) if args.json else result["output"])
    return 0


def render_bastardloop(args: argparse.Namespace) -> int:
    plugin_dirs = [pathlib.Path(value) for value in args.plugin_dir] if args.plugin_dir else None
    plugin_path = None if args.bypass else resolve_plugin(args.plugin, plugin_dirs)
    source_name = sanitize_wav_filename(args.file)
    input_path = (MYGRAIN_BASTARDLOOPS_ROOT / source_name).resolve()
    if input_path.parent != MYGRAIN_BASTARDLOOPS_ROOT.resolve():
        raise ValueError("Invalid Bastardloop filename.")
    plugin_slug = "bypass" if args.bypass else re.sub(r"[^A-Za-z0-9._-]+", "-", plugin_path.stem).strip("._-")
    output_name = sanitize_wav_filename(args.output or f"{input_path.stem}--{plugin_slug}.wav")
    output_path = (MYGRAIN_VST3_RENDERS_ROOT / output_name).resolve()
    parameters = dict(args.parameter or [])
    result = render_audio(
        input_path=input_path,
        output_path=output_path,
        plugin_path=plugin_path,
        plugin_name=args.plugin_name,
        parameters=parameters,
        tail_seconds=args.tail_seconds,
        buffer_size=args.buffer_size,
        initialization_timeout=args.timeout,
        bypass=args.bypass,
    )
    result["repository"] = str(MYGRAIN_VST3_RENDERS_ROOT)
    result["sourceName"] = source_name
    print(json.dumps(result, indent=2) if args.json else result["output"])
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="MYGRAIN offline VST3 render host")
    subparsers = parser.add_subparsers(dest="command", required=True)

    list_parser = subparsers.add_parser("list", help="list discoverable VST3 plugins")
    list_parser.add_argument("--plugin-dir", action="append", default=[], help="extra or replacement VST3 scan directory")
    list_parser.add_argument("--json", action="store_true", help="print JSON")
    list_parser.set_defaults(func=list_plugins)

    def add_render_args(render_parser: argparse.ArgumentParser) -> None:
        render_parser.add_argument("--plugin", help="VST3 bundle path or discovered plugin name")
        render_parser.add_argument("--plugin-name", help="plugin name inside a multi-plugin VST3 bundle")
        render_parser.add_argument("--plugin-dir", action="append", default=[], help="extra or replacement VST3 scan directory")
        render_parser.add_argument("--parameter", "-p", action="append", type=parse_parameter, default=[], help="plugin parameter as KEY=VALUE")
        render_parser.add_argument("--tail-seconds", type=float, default=0.0, help="append silence before rendering to capture delays/reverb")
        render_parser.add_argument("--buffer-size", type=int, default=8192, help="render buffer size")
        render_parser.add_argument("--timeout", type=float, default=30.0, help="plugin initialisation timeout in seconds")
        render_parser.add_argument("--bypass", action="store_true", help="copy through the host path without loading a plugin")
        render_parser.add_argument("--json", action="store_true", help="print JSON")

    file_parser = subparsers.add_parser("render", help="process any WAV file through a VST3 effect")
    add_render_args(file_parser)
    file_parser.add_argument("--input", required=True, help="input WAV path")
    file_parser.add_argument("--output", required=True, help="output WAV path")
    file_parser.set_defaults(func=render_file)

    bastard_parser = subparsers.add_parser("bastardloop", help="process a Bastardloop repository WAV")
    add_render_args(bastard_parser)
    bastard_parser.add_argument("--file", required=True, help="Bastardloop repository WAV filename")
    bastard_parser.add_argument("--output", help="output WAV filename in the VST3 renders repository")
    bastard_parser.set_defaults(func=render_bastardloop)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not getattr(args, "bypass", False) and getattr(args, "command", None) in {"render", "bastardloop"} and not args.plugin:
        parser.error("--plugin is required unless --bypass is set")
    try:
        return args.func(args)
    except Exception as exc:
        if getattr(args, "json", False):
            print(json.dumps({"ok": False, "error": str(exc)}), file=sys.stderr)
        else:
            print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
