#!/usr/bin/env python3
"""Provider-free, fail-closed SAM worker image-content boundary."""

from __future__ import annotations

import hashlib
import re
import shlex
import stat
import subprocess
import sys
import urllib.parse
from pathlib import Path
from typing import Mapping, Sequence

WORKER_DIRECTORY = "services/sam-worker"
DOCKERFILE = WORKER_DIRECTORY + "/Dockerfile"
DOCKERIGNORE = WORKER_DIRECTORY + "/Dockerfile.dockerignore"
ARTIFACT_MANIFEST = WORKER_DIRECTORY + "/artifact-manifest.json"
ADAPTER_PROFILE = WORKER_DIRECTORY + "/adapter-profile.json"
DEPENDENCY_LICENSES = WORKER_DIRECTORY + "/dependency-licenses.json"
REQUIREMENTS_LOCK = WORKER_DIRECTORY + "/requirements.lock"
WHEELHOUSE_MANIFEST = WORKER_DIRECTORY + "/wheelhouse-manifest.json"
ACQUISITION_PROGRAM = WORKER_DIRECTORY + "/acquire_build.py"

EXPECTED_CONTEXT_IDENTITIES = {
    DOCKERFILE: "79dd83e32bb32a985f36efd494c8b87867e1903aa9c0696f277392b3acb1797e",
    ARTIFACT_MANIFEST: (
        "412c430426d0cfcba50b908d2909907adda64813b7b1165642b8db677a8d6251"
    ),
    ADAPTER_PROFILE: (
        "93dfa19521a20d31ebd548de95e18c5f549e63350dd0d8aeb4e7c5075d49557e"
    ),
    DEPENDENCY_LICENSES: (
        "2ff748f49c22662c25058397606f419bd5cc213d6797e3be7f6a8e4f9e52a95e"
    ),
    REQUIREMENTS_LOCK: (
        "a52ec65c9bb270eef33a71dbf8971731dbf99135ecdffad6f392e39b6c42d525"
    ),
    WHEELHOUSE_MANIFEST: (
        "390054e8574bda53e710cefcbeb44a5dcdaba35f79cf4cfa029bf079deadd39b"
    ),
    ACQUISITION_PROGRAM: (
        "4e11cdca7e594c3599ab091ba33da001630703811a32d4d4ae3b3c59ef9bc049"
    ),
    WORKER_DIRECTORY + "/runtime-overlay/iopath/__init__.py": (
        "9e3054fa384d5dac8b4c9d0bd8b4ef4f5f636199f6a753b03f8a973b19774a49"
    ),
    WORKER_DIRECTORY + "/runtime-overlay/iopath/common/__init__.py": (
        "c8dc6eed8284b99baa822d243e1238456b1c34922b24b982c7babaf0a16bb6ec"
    ),
    WORKER_DIRECTORY + "/runtime-overlay/iopath/common/file_io.py": (
        "244cfeee411cf6b9131d2990ee76a77e51cf6f6160a8108acbc53c007b65e0d4"
    ),
    WORKER_DIRECTORY + "/runtime-overlay/sam2/__init__.py": (
        "64056d592e79eddb3605669848ee3dbc40f91d07511a20bb37a43f81ae49b80d"
    ),
    WORKER_DIRECTORY + "/sam_worker/__init__.py": (
        "e85ffc89a37e6783a95b0725aec7668cda1faa06cb6703d9066cd4585b202459"
    ),
    WORKER_DIRECTORY + "/sam_worker/app.py": (
        "8e4313f0efb14ea3dd996fa1cbf3190abe1eafe93561f1f14d61423349e873fc"
    ),
    WORKER_DIRECTORY + "/sam_worker/artifacts.py": (
        "1846c454ff7841f8cd9d01f94f72c03828d47428967d2dc96ba74940a10be45f"
    ),
    WORKER_DIRECTORY + "/sam_worker/engine.py": (
        "0c38620212e8cb6f7a5dcc2130c4700c938fc06159d9628eb3b4560b3cc4fad4"
    ),
    WORKER_DIRECTORY + "/sam_worker/health.py": (
        "010555b49e68c3d27564dbda9a5169f644e09856e3df838979796d3d3fa229a9"
    ),
    WORKER_DIRECTORY + "/sam_worker/hosting.py": (
        "55e8f0b6108af002f81ef59ce0000c100b64cee1252eec856ec2ef318b88f2b6"
    ),
    WORKER_DIRECTORY + "/sam_worker/model_loader.py": (
        "ec90d83f41840970b8df9947229908aad49fc15c71386096a60fe83318cf90dc"
    ),
    WORKER_DIRECTORY + "/sam_worker/protocol.py": (
        "b8e311ce63ab9e1aa47abd6d6d8d66553c71f248d3ddc494674f68f087382f28"
    ),
    WORKER_DIRECTORY + "/sam_worker/runtime.py": (
        "89124232de7c3f079bfa31593def66a01f2040539ba01c5c5b9e9c4223237aaf"
    ),
    WORKER_DIRECTORY + "/sam_worker/server.py": (
        "c00a3381022e34dd286dc25027206e86067650d2779af37259ff2868d6d25af5"
    ),
}
EXPECTED_CONTROL_IDENTITIES = {
    DOCKERIGNORE: (
        "437386c05c464d1025bf4f596c0cf59a4e938ba280b18c415d0560afb8e1256e"
    ),
}
EXPECTED_DOCKERIGNORE_LINES = (
    "**",
    "!services/",
    "!services/sam-worker/",
    "!services/sam-worker/Dockerfile",
    "!services/sam-worker/artifact-manifest.json",
    "!services/sam-worker/adapter-profile.json",
    "!services/sam-worker/dependency-licenses.json",
    "!services/sam-worker/requirements.lock",
    "!services/sam-worker/wheelhouse-manifest.json",
    "!services/sam-worker/acquire_build.py",
    "!services/sam-worker/runtime-overlay/",
    "!services/sam-worker/runtime-overlay/iopath/",
    "!services/sam-worker/runtime-overlay/iopath/__init__.py",
    "!services/sam-worker/runtime-overlay/iopath/common/",
    "!services/sam-worker/runtime-overlay/iopath/common/__init__.py",
    "!services/sam-worker/runtime-overlay/iopath/common/file_io.py",
    "!services/sam-worker/runtime-overlay/sam2/",
    "!services/sam-worker/runtime-overlay/sam2/__init__.py",
    "!services/sam-worker/sam_worker/",
    "!services/sam-worker/sam_worker/__init__.py",
    "!services/sam-worker/sam_worker/app.py",
    "!services/sam-worker/sam_worker/artifacts.py",
    "!services/sam-worker/sam_worker/engine.py",
    "!services/sam-worker/sam_worker/health.py",
    "!services/sam-worker/sam_worker/hosting.py",
    "!services/sam-worker/sam_worker/model_loader.py",
    "!services/sam-worker/sam_worker/protocol.py",
    "!services/sam-worker/sam_worker/runtime.py",
    "!services/sam-worker/sam_worker/server.py",
)
EXPECTED_BASE = (
    "--platform=linux/amd64 "
    "pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime@"
    "sha256:c8268a92a69bd500f8be0e665b2630ee006dadaf7bfbc24249141b15ff622755"
)
EXPECTED_LOCAL_COPIES = (
    (
        "services/sam-worker/sam_worker",
        "/opt/fabrica/worker/sam_worker",
    ),
    (
        "services/sam-worker/runtime-overlay",
        "/opt/fabrica/sam2-overlay",
    ),
    (
        "services/sam-worker/artifact-manifest.json",
        "/opt/fabrica/sam/artifact-manifest.json",
    ),
    (
        "services/sam-worker/adapter-profile.json",
        "/opt/fabrica/sam/adapter-profile.json",
    ),
    (
        "services/sam-worker/dependency-licenses.json",
        "/opt/fabrica/sam/dependency-licenses.json",
    ),
    (
        "services/sam-worker/requirements.lock",
        "/opt/fabrica/build/requirements.lock",
    ),
    (
        "services/sam-worker/wheelhouse-manifest.json",
        "/opt/fabrica/build/wheelhouse-manifest.json",
    ),
    (
        "services/sam-worker/acquire_build.py",
        "/opt/fabrica/build/acquire.py",
    ),
)
EXPECTED_STAGE_COPIES = (
    (
        "/opt/fabrica/closed/worker",
        "/opt/fabrica/worker",
    ),
    (
        "/opt/fabrica/closed/sam2-overlay",
        "/opt/fabrica/sam2-overlay",
    ),
    (
        "/opt/fabrica/closed/sam2-source",
        "/opt/fabrica/sam2-source",
    ),
    (
        "/opt/fabrica/closed/sam",
        "/opt/fabrica/sam",
    ),
    (
        "/opt/fabrica/closed/requirements.lock",
        "/opt/fabrica/sam/requirements.lock",
    ),
    (
        "/opt/fabrica/closed/wheelhouse-manifest.json",
        "/opt/fabrica/sam/wheelhouse-manifest.json",
    ),
)
FORBIDDEN_PATH_PARTS = {
    ".aws",
    ".cache",
    ".docker",
    ".env",
    ".git",
    ".github",
    ".idea",
    ".pytest_cache",
    ".ssh",
    ".vscode",
    "__pycache__",
    "credentials",
    "fixtures",
    "images",
    "node_modules",
    "provider-responses",
    "reports",
    "tests",
}
SHA256_PATTERN = re.compile(r"[0-9a-f]{64}")


class BoundaryError(RuntimeError):
    """A sanitized static image-content boundary failure."""

    def __init__(self, code: str) -> None:
        if re.fullmatch(r"[a-z0-9-]+", code) is None:
            code = "internal-boundary"
        super().__init__(code)
        self.code = code


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as source:
            while True:
                block = source.read(1024 * 1024)
                if not block:
                    break
                digest.update(block)
    except OSError as error:
        raise BoundaryError("input-unreadable") from error
    return digest.hexdigest()


def _tracked_modes(root: Path, paths: set[str]) -> Mapping[str, str]:
    try:
        result = subprocess.run(
            [
                "git",
                "-C",
                str(root),
                "ls-files",
                "--stage",
                "-z",
                "--",
                *sorted(paths),
            ],
            check=True,
            capture_output=True,
        )
    except (OSError, subprocess.CalledProcessError) as error:
        raise BoundaryError("tracked-input-query") from error
    modes: dict[str, str] = {}
    for entry in result.stdout.split(b"\0"):
        if not entry:
            continue
        try:
            metadata, path_bytes = entry.split(b"\t", 1)
            mode, _object_id, stage = metadata.decode("ascii").split()
            path = path_bytes.decode("utf-8", errors="strict")
        except (UnicodeDecodeError, ValueError) as error:
            raise BoundaryError("tracked-input-envelope") from error
        if path in modes or stage != "0":
            raise BoundaryError("tracked-input-envelope")
        modes[path] = mode
    return modes


def _verify_exact_inputs(
    root: Path,
    tracked_modes: Mapping[str, str] | None,
) -> None:
    identities = {
        **EXPECTED_CONTEXT_IDENTITIES,
        **EXPECTED_CONTROL_IDENTITIES,
    }
    expected = set(identities)
    observed_modes = (
        _tracked_modes(root, expected)
        if tracked_modes is None
        else dict(tracked_modes)
    )
    if set(observed_modes) != expected:
        raise BoundaryError("tracked-input-set")
    for relative, expected_digest in identities.items():
        path = root / relative
        try:
            metadata = path.lstat()
        except OSError as error:
            raise BoundaryError("input-unreadable") from error
        if (
            observed_modes[relative] != "100644"
            or not stat.S_ISREG(metadata.st_mode)
            or path.is_symlink()
            or _sha256(path) != expected_digest
        ):
            raise BoundaryError("tracked-input-identity")
        parts = set(Path(relative).parts)
        if parts & FORBIDDEN_PATH_PARTS:
            raise BoundaryError("forbidden-context-path")


def _dockerfile_instructions(data: bytes) -> Sequence[tuple[str, str]]:
    try:
        text = data.decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise BoundaryError("dockerfile-encoding") from error
    logical: list[str] = []
    pending = ""
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or (line.startswith("#") and not pending):
            continue
        pending = (pending + " " + line).strip()
        if pending.endswith("\\"):
            pending = pending[:-1].rstrip()
            continue
        logical.append(pending)
        pending = ""
    if pending:
        raise BoundaryError("dockerfile-continuation")
    instructions: list[tuple[str, str]] = []
    for line in logical:
        parts = line.split(None, 1)
        if len(parts) != 2:
            raise BoundaryError("dockerfile-instruction")
        instructions.append((parts[0].upper(), parts[1]))
    return instructions


def _copy_identity(value: str) -> tuple[str | None, str, str]:
    try:
        parts = shlex.split(value, posix=True)
    except ValueError as error:
        raise BoundaryError("dockerfile-copy") from error
    stage: str | None = None
    if parts and parts[0].startswith("--from="):
        stage = parts.pop(0).split("=", 1)[1]
    if (
        len(parts) != 2
        or any(part.startswith("--") for part in parts)
        or any(
            character in parts[0]
            for character in ("*", "?", "[", "]")
        )
        or parts[0] in (".", "./", "/")
        or urllib.parse.urlsplit(parts[0]).scheme
    ):
        raise BoundaryError("dockerfile-copy")
    return stage, parts[0].rstrip("/"), parts[1].rstrip("/")


def _verify_dockerfile(root: Path) -> None:
    try:
        data = (root / DOCKERFILE).read_bytes()
    except OSError as error:
        raise BoundaryError("dockerfile-unreadable") from error
    instructions = _dockerfile_instructions(data)
    if any(name == "ADD" for name, _value in instructions):
        raise BoundaryError("dockerfile-add")
    from_values = [
        value for name, value in instructions if name == "FROM"
    ]
    if from_values != [
        EXPECTED_BASE + " AS acquisition",
        EXPECTED_BASE + " AS runtime",
    ]:
        raise BoundaryError("dockerfile-stage")
    args = [value for name, value in instructions if name == "ARG"]
    if args != ["FABRICA_GIT_SHA"]:
        raise BoundaryError("dockerfile-arg")
    environment_values = [
        value for name, value in instructions if name == "ENV"
    ]
    if (
        len(environment_values) != 2
        or "PIP_CONFIG_FILE=/dev/null" not in environment_values[0]
        or "HF_HUB_OFFLINE=1" not in environment_values[0]
        or "TRANSFORMERS_OFFLINE=1" not in environment_values[0]
        or "PIP_NO_INDEX=1" not in environment_values[1]
        or "HF_HUB_OFFLINE=1" not in environment_values[1]
        or "TRANSFORMERS_OFFLINE=1" not in environment_values[1]
    ):
        raise BoundaryError("dockerfile-environment")

    local_copies: list[tuple[str, str]] = []
    stage_copies: list[tuple[str, str]] = []
    for name, value in instructions:
        if name != "COPY":
            continue
        stage, source, destination = _copy_identity(value)
        if stage is None:
            local_copies.append((source, destination))
        elif stage == "acquisition":
            stage_copies.append((source, destination))
        else:
            raise BoundaryError("dockerfile-copy-stage")
    if (
        tuple(local_copies) != EXPECTED_LOCAL_COPIES
        or tuple(stage_copies) != EXPECTED_STAGE_COPIES
    ):
        raise BoundaryError("dockerfile-copy-graph")

    runs = [value for name, value in instructions if name == "RUN"]
    if (
        sum("--network=default" in value for value in runs) != 1
        or sum(
            "python /opt/fabrica/build/acquire.py" in value
            for value in runs
        )
        != 1
    ):
        raise BoundaryError("dockerfile-network-graph")
    mounts = [
        token
        for value in runs
        for token in value.split()
        if token.startswith("--mount=")
    ]
    if mounts != [
        (
            "--mount=from=acquisition,"
            "source=/opt/fabrica/closed/wheelhouse,"
            "target=/opt/fabrica/wheelhouse,ro"
        )
    ]:
        raise BoundaryError("dockerfile-mount-graph")
    for value in runs:
        lowered = value.lower()
        if (
            "--mount=type=secret" in lowered
            or "--mount=type=ssh" in lowered
            or (
                "--network=none" not in value
                and "--network=default" not in value
            )
        ):
            raise BoundaryError("dockerfile-run-boundary")
    final_directives = [
        (name, value)
        for name, value in instructions
        if name
        in {
            "CMD",
            "EXPOSE",
            "HEALTHCHECK",
            "USER",
            "WORKDIR",
        }
    ]
    if final_directives != [
        ("EXPOSE", "80/tcp"),
        ("USER", "10001:10001"),
        ("WORKDIR", "/opt/fabrica/worker"),
        ("HEALTHCHECK", "NONE"),
        ("CMD", '["python", "-m", "sam_worker.server"]'),
    ]:
        raise BoundaryError("dockerfile-runtime-directives")


def _verify_dockerignore(root: Path) -> None:
    try:
        lines = (root / DOCKERIGNORE).read_text(
            encoding="utf-8",
            errors="strict",
        ).splitlines()
    except (OSError, UnicodeDecodeError) as error:
        raise BoundaryError("dockerignore-unreadable") from error
    if tuple(lines) != EXPECTED_DOCKERIGNORE_LINES:
        raise BoundaryError("dockerignore-allowlist")
    included_files = {
        line[1:]
        for line in lines
        if line.startswith("!") and not line.endswith("/")
    }
    if included_files != set(EXPECTED_CONTEXT_IDENTITIES):
        raise BoundaryError("dockerignore-context-set")


def _validated_download_url(
    value: object,
    *,
    expected_host: str,
) -> None:
    if not isinstance(value, str) or not value.isascii():
        raise BoundaryError("download-url")
    parsed = urllib.parse.urlsplit(value)
    if (
        parsed.scheme != "https"
        or parsed.hostname != expected_host
        or parsed.port is not None
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise BoundaryError("download-url")


def _verify_artifact_graph(root: Path) -> None:
    module_root = root / WORKER_DIRECTORY
    sys.path.insert(0, str(module_root))
    try:
        from sam_worker.artifacts import (  # pylint: disable=import-outside-toplevel
            load_reviewed_manifest,
            verify_dependency_input_set,
        )

        manifest = load_reviewed_manifest(root / ARTIFACT_MANIFEST)
        _locked, wheels, dependency_graph = verify_dependency_input_set(
            manifest,
            requirements_lock_path=root / REQUIREMENTS_LOCK,
            wheelhouse_inventory_path=root / WHEELHOUSE_MANIFEST,
            dependency_licenses_path=root / DEPENDENCY_LICENSES,
        )
    except Exception as error:
        if error.__class__.__name__ == "ArtifactError":
            raise BoundaryError("artifact-contract") from error
        raise
    finally:
        try:
            sys.path.remove(str(module_root))
        except ValueError:
            pass

    archive = manifest["repository"]["archive"]
    checkpoint = manifest["checkpoint"]
    _validated_download_url(
        archive.get("url"),
        expected_host="codeload.github.com",
    )
    _validated_download_url(
        checkpoint.get("url"),
        expected_host="dl.fbaipublicfiles.com",
    )
    if (
        archive.get("url")
        != (
            "https://codeload.github.com/facebookresearch/sam2/tar.gz/"
            + manifest["repository"]["commit"]
        )
        or not isinstance(archive.get("byteSize"), int)
        or archive["byteSize"] < 1
        or SHA256_PATTERN.fullmatch(str(archive.get("sha256"))) is None
        or not isinstance(checkpoint.get("byteSize"), int)
        or checkpoint["byteSize"] < 1
        or SHA256_PATTERN.fullmatch(str(checkpoint.get("sha256"))) is None
    ):
        raise BoundaryError("artifact-download-identity")
    for wheel in wheels:
        _validated_download_url(
            wheel.get("url"),
            expected_host="files.pythonhosted.org",
        )
        if (
            not isinstance(wheel.get("filename"), str)
            or not wheel["url"].endswith("/" + wheel["filename"])
            or not isinstance(wheel.get("byteSize"), int)
            or wheel["byteSize"] < 1
            or SHA256_PATTERN.fullmatch(str(wheel.get("sha256"))) is None
        ):
            raise BoundaryError("wheel-download-identity")
    if (
        len(wheels) != 16
        or len(dependency_graph) != len(wheels)
        or len(manifest["licenses"]["runtime"]) != 2
        or {
            entry.get("spdx")
            for entry in manifest["licenses"]["runtime"]
        }
        != {"Apache-2.0", "BSD-3-Clause"}
    ):
        raise BoundaryError("license-graph")


def _verify_acquisition_graph(root: Path) -> None:
    try:
        source = (root / ACQUISITION_PROGRAM).read_text(
            encoding="utf-8",
            errors="strict",
        )
    except (OSError, UnicodeDecodeError) as error:
        raise BoundaryError("acquisition-unreadable") from error
    required_markers = (
        'ARCHIVE_HOST = "codeload.github.com"',
        'CHECKPOINT_HOST = "dl.fbaipublicfiles.com"',
        'WHEEL_HOST = "files.pythonhosted.org"',
        "ProxyHandler({})",
        "for wheel in wheel_entries:",
        "verify_source_archive(archive, manifest)",
        "verify_checkpoint_artifact(checkpoint, manifest)",
        "verify_dependency_build_ready(",
        "_copy_closed_tree(arguments.worker_root, closed / \"worker/sam_worker\")",
        "_copy_closed_tree(IMAGE_SOURCE_ROOT, closed / \"sam2-source\")",
        "_copy_closed_tree(wheelhouse, closed / \"wheelhouse\")",
        'if {entry.name for entry in closed.iterdir()} != {',
    )
    if any(marker not in source for marker in required_markers):
        raise BoundaryError("acquisition-graph")
    forbidden = (
        "requests.",
        "subprocess.",
        "os.system(",
        "shell=True",
        "git clone",
        "pip download",
    )
    if any(marker in source for marker in forbidden):
        raise BoundaryError("acquisition-download-path")


def verify_image_content(
    root: Path,
    *,
    tracked_modes: Mapping[str, str] | None = None,
) -> None:
    root = root.resolve()
    if not root.is_dir():
        raise BoundaryError("repository-root")
    _verify_exact_inputs(root, tracked_modes)
    _verify_dockerignore(root)
    _verify_dockerfile(root)
    _verify_artifact_graph(root)
    _verify_acquisition_graph(root)


def main(argv: Sequence[str] | None = None) -> int:
    arguments = sys.argv[1:] if argv is None else list(argv)
    if arguments:
        raise BoundaryError("arguments")
    root = Path(__file__).resolve().parents[2]
    verify_image_content(root)
    print(
        "sam-worker-image-content-boundary-ok "
        "context-files=21 reviewed-downloads=18"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BoundaryError as error:
        raise SystemExit(
            "sam-worker-image-content-boundary-invalid:%s" % error.code
        ) from None
    except Exception:
        raise SystemExit(
            "sam-worker-image-content-boundary-invalid:"
            "unexpected-local-failure"
        ) from None
