from __future__ import annotations

import base64
import copy
import hashlib
import hmac
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.parse
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Mapping

from ghcr_publication import (
    PublicationError,
    _read_bounded_response,
    parse_registry_token,
)
from image_manifest import (
    OCI_IMAGE_CONFIG,
    OCI_IMAGE_MANIFEST,
)

ROOT = Path(__file__).resolve().parents[3]
CLI = ROOT / "services/sam-worker/ghcr_publication.py"
SOURCE_COMMIT = "e3bb2eea5fe251e30e7541aa80768d004a1ffb14"
GITHUB_TOKEN = "synthetic-github-token-never-emit"
REGISTRY_TOKEN = "synthetic-registry-token-never-emit"


def encoded(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def digest(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def image_fixture() -> tuple[bytes, bytes]:
    config = encoded(
        {
            "architecture": "amd64",
            "config": {
                "Labels": {
                    "org.opencontainers.image.revision": (
                        SOURCE_COMMIT
                    ),
                    "org.opencontainers.image.source": (
                        "https://github.com/moodworks/fabrica-kit"
                    ),
                }
            },
            "os": "linux",
            "rootfs": {"diff_ids": [], "type": "layers"},
        }
    )
    layer = b"provider-free-layer"
    manifest = encoded(
        {
            "config": {
                "digest": digest(config),
                "mediaType": OCI_IMAGE_CONFIG,
                "size": len(config),
            },
            "layers": [
                {
                    "digest": digest(layer),
                    "mediaType": (
                        "application/vnd.oci.image.layer.v1.tar+gzip"
                    ),
                    "size": len(layer),
                }
            ],
            "mediaType": OCI_IMAGE_MANIFEST,
            "schemaVersion": 2,
        }
    )
    return manifest, config


def private_package_metadata() -> Mapping[str, Any]:
    return {
        "id": 101,
        "name": "fabrica-sam-worker",
        "owner": {
            "id": 202,
            "login": "moodworks",
            "type": "User",
        },
        "package_type": "container",
        "repository": {
            "full_name": "moodworks/fabrica-kit",
            "id": 303,
            "name": "fabrica-kit",
            "owner": {
                "id": 202,
                "login": "moodworks",
                "type": "User",
            },
        },
        "visibility": "private",
    }


@dataclass
class Scenario:
    package_status: int = 200
    package_body: bytes = field(
        default_factory=lambda: encoded(private_package_metadata())
    )
    token_status: int = 200
    token_body: bytes = field(
        default_factory=lambda: encoded(
            {
                "expires_in": 300,
                "issued_at": "2026-07-20T00:00:00Z",
                "token": REGISTRY_TOKEN,
            }
        )
    )
    manifest: bytes = field(
        default_factory=lambda: image_fixture()[0]
    )
    config: bytes = field(
        default_factory=lambda: image_fixture()[1]
    )
    hits: list[str] = field(default_factory=list)


class FixtureServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, scenario: Scenario) -> None:
        self.scenario = scenario
        super().__init__(
            ("127.0.0.1", 0),
            FixtureHandler,
        )


class FixtureHandler(BaseHTTPRequestHandler):
    server: FixtureServer

    def log_message(
        self,
        format_value: str,
        *args: object,
    ) -> None:
        return

    def _send(
        self,
        status: int,
        body: bytes,
        *,
        content_type: str = "application/json",
        content_digest: str | None = None,
    ) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        if content_digest is not None:
            self.send_header(
                "Docker-Content-Digest",
                content_digest,
            )
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urllib.parse.urlsplit(self.path)
        scenario = self.server.scenario
        package_path = (
            "/users/moodworks/packages/container/"
            "fabrica-sam-worker"
        )
        if parsed.path == package_path:
            scenario.hits.append("package")
            if (
                self.headers.get("Authorization")
                != "Bearer " + GITHUB_TOKEN
            ):
                self._send(401, b"{}")
                return
            self._send(
                scenario.package_status,
                scenario.package_body,
            )
            return
        if parsed.path == "/token":
            scenario.hits.append("token")
            expected_basic = "Basic " + (
                base64.b64encode(
                    (
                        "fixture-actor:"
                        + GITHUB_TOKEN
                    ).encode("utf-8")
                )
                .decode("ascii")
            )
            if (
                self.headers.get("Authorization")
                != expected_basic
            ):
                self._send(401, b"{}")
                return
            self._send(
                scenario.token_status,
                scenario.token_body,
            )
            return
        manifest_digest = digest(scenario.manifest)
        if parsed.path == (
            "/v2/moodworks/fabrica-sam-worker/manifests/"
            + manifest_digest
        ):
            scenario.hits.append("manifest")
            if (
                self.headers.get("Authorization")
                != "Bearer " + REGISTRY_TOKEN
            ):
                self._send(401, b"{}")
                return
            self._send(
                200,
                scenario.manifest,
                content_type=OCI_IMAGE_MANIFEST,
                content_digest=manifest_digest,
            )
            return
        config_digest = digest(scenario.config)
        if parsed.path == (
            "/v2/moodworks/fabrica-sam-worker/blobs/"
            + config_digest
        ):
            scenario.hits.append("config")
            if (
                self.headers.get("Authorization")
                != "Bearer " + REGISTRY_TOKEN
            ):
                self._send(401, b"{}")
                return
            self._send(
                200,
                scenario.config,
                content_type="application/octet-stream",
            )
            return
        scenario.hits.append("foreign")
        self._send(404, b"{}")


class GhcrPublicationEntrypointTests(unittest.TestCase):
    def _run(
        self,
        scenario: Scenario,
        command: str,
        *,
        include_github_token: bool = True,
    ) -> tuple[
        subprocess.CompletedProcess[str],
        Mapping[str, str],
        list[str],
    ]:
        server = FixtureServer(scenario)
        thread = threading.Thread(
            target=server.serve_forever,
            daemon=True,
        )
        thread.start()
        try:
            base_url = (
                "http://127.0.0.1:%d"
                % server.server_address[1]
            )
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                github_output = root / "github-output"
                step_summary = root / "step-summary"
                build_metadata = root / "build-metadata.json"
                github_output.write_text("", encoding="utf-8")
                step_summary.write_text("", encoding="utf-8")
                build_metadata.write_text(
                    json.dumps(
                        {
                            "containerimage.digest": digest(
                                scenario.manifest
                            )
                        },
                        separators=(",", ":"),
                    ),
                    encoding="utf-8",
                )
                arguments = [
                    sys.executable,
                    str(CLI),
                    "--allow-loopback-test-endpoints",
                    "--github-api-base-url",
                    base_url,
                    "--registry-api-base-url",
                    base_url,
                    "--registry-token-url",
                    base_url + "/token",
                    command,
                ]
                if command == "package-preflight":
                    arguments.extend(
                        [
                            "--github-output",
                            str(github_output),
                        ]
                    )
                elif command == "package-confirm":
                    arguments.extend(
                        [
                            "--github-output",
                            str(github_output),
                        ]
                    )
                elif command == "verify-image":
                    arguments.extend(
                        [
                            "--build-metadata",
                            str(build_metadata),
                            "--source-commit",
                            SOURCE_COMMIT,
                            "--github-output",
                            str(github_output),
                            "--step-summary",
                            str(step_summary),
                        ]
                    )
                else:
                    raise AssertionError("unsupported test command")
                environment = dict(os.environ)
                environment.pop("GITHUB_TOKEN", None)
                environment.update(
                    {
                        "GITHUB_ACTOR": "fixture-actor",
                        "PYTHONDONTWRITEBYTECODE": "1",
                    }
                )
                if include_github_token:
                    environment["GITHUB_TOKEN"] = GITHUB_TOKEN
                result = subprocess.run(
                    arguments,
                    cwd=ROOT,
                    env=environment,
                    capture_output=True,
                    check=False,
                    text=True,
                    timeout=10,
                )
                files = {
                    path.name: path.read_text("utf-8")
                    for path in root.iterdir()
                    if path.is_file()
                }
                return result, files, list(scenario.hits)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def assert_no_token_disclosure(
        self,
        result: subprocess.CompletedProcess[str],
        files: Mapping[str, str],
    ) -> None:
        for secret in (GITHUB_TOKEN, REGISTRY_TOKEN):
            self.assertFalse(
                secret in result.stdout,
                "credential marker appeared on stdout",
            )
            self.assertFalse(
                secret in result.stderr,
                "credential marker appeared on stderr",
            )
            for content in files.values():
                self.assertFalse(
                    secret in content,
                    "credential marker appeared in a persisted file",
                )

    def test_successful_token_envelopes_are_strictly_parsed(self) -> None:
        envelopes = (
            {"token": REGISTRY_TOKEN},
            {"access_token": REGISTRY_TOKEN},
            {
                "access_token": REGISTRY_TOKEN,
                "expires_in": 300,
                "issued_at": "2026-07-20T00:00:00Z",
                "token": REGISTRY_TOKEN,
            },
        )
        for envelope in envelopes:
            with self.subTest(envelope=tuple(envelope)):
                self.assertTrue(
                    hmac.compare_digest(
                        parse_registry_token(encoded(envelope)),
                        REGISTRY_TOKEN,
                    ),
                    "token envelope selected the wrong field",
                )

    def test_valid_entrypoint_reaches_manifest_and_config_verification(
        self,
    ) -> None:
        scenario = Scenario()
        result, files, hits = self._run(
            scenario,
            "verify-image",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr, "")
        self.assertEqual(
            hits,
            ["token", "manifest", "config", "package"],
        )
        manifest_digest = digest(scenario.manifest)
        self.assertIn(
            "platform_manifest_digest=" + manifest_digest,
            files["github-output"],
        )
        self.assertIn(
            (
                "image_reference=ghcr.io/moodworks/"
                "fabrica-sam-worker@"
                + manifest_digest
            ),
            files["github-output"],
        )
        self.assertIn(
            "Verified private SAM worker image identity",
            files["step-summary"],
        )
        self.assert_no_token_disclosure(result, files)

    def test_success_metadata_requires_post_verification_private_gate(
        self,
    ) -> None:
        metadata = dict(private_package_metadata())
        metadata["visibility"] = "public"
        scenario = Scenario(package_body=encoded(metadata))
        result, files, hits = self._run(
            scenario,
            "verify-image",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(
            hits,
            ["token", "manifest", "config", "package"],
        )
        self.assertEqual(files["github-output"], "")
        self.assertEqual(files["step-summary"], "")
        self.assert_no_token_disclosure(result, files)

    def test_token_envelope_failures_stop_before_manifest_fetch(
        self,
    ) -> None:
        cases = (
            ("malformed", b"{"),
            ("missing", encoded({"expires_in": 300})),
            (
                "unexpected",
                encoded(
                    {
                        "foreign": True,
                        "token": REGISTRY_TOKEN,
                    }
                ),
            ),
            ("wrong-type", encoded({"token": 7})),
            (
                "conflicting",
                encoded(
                    {
                        "access_token": "different-token",
                        "token": REGISTRY_TOKEN,
                    }
                ),
            ),
        )
        for case, body in cases:
            with self.subTest(case=case):
                scenario = Scenario(token_body=body)
                result, files, hits = self._run(
                    scenario,
                    "verify-image",
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "")
                self.assertEqual(hits, ["token"])
                self.assertIn(
                    (
                        "sam-worker-ghcr-publication-invalid:"
                        "registry-token-envelope"
                    ),
                    result.stderr,
                )
                self.assert_no_token_disclosure(result, files)

    def test_token_http_failure_and_missing_github_token_fail_closed(
        self,
    ) -> None:
        http_scenario = Scenario(token_status=503)
        result, files, hits = self._run(
            http_scenario,
            "verify-image",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(hits, ["token"])
        self.assertIn(
            "registry-token-http",
            result.stderr,
        )
        self.assert_no_token_disclosure(result, files)

        missing_scenario = Scenario()
        result, files, hits = self._run(
            missing_scenario,
            "verify-image",
            include_github_token=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(hits, [])
        self.assertIn(
            "github-token-missing",
            result.stderr,
        )
        self.assert_no_token_disclosure(result, files)

    def test_package_preflight_404_allows_only_bootstrap_path(
        self,
    ) -> None:
        scenario = Scenario(
            package_status=404,
            package_body=b"{}",
        )
        result, files, hits = self._run(
            scenario,
            "package-preflight",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(hits, ["package"])
        self.assertEqual(
            files["github-output"],
            (
                "bootstrap_required=true\n"
                "package_state=absent-or-inaccessible\n"
            ),
        )
        self.assert_no_token_disclosure(result, files)

    def test_private_linked_package_proves_authenticated_actions_access(
        self,
    ) -> None:
        scenario = Scenario()
        result, files, hits = self._run(
            scenario,
            "package-confirm",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(hits, ["package"])
        self.assertEqual(
            files["github-output"],
            (
                "package_visibility=private\n"
                "package_owner=moodworks\n"
                "package_repository=moodworks/fabrica-kit\n"
                "actions_access_proof=authenticated-package-get\n"
            ),
        )
        self.assert_no_token_disclosure(result, files)

    def test_public_internal_mislinked_and_inaccessible_packages_fail(
        self,
    ) -> None:
        cases: list[tuple[str, int, bytes]] = []
        for visibility in ("public", "internal"):
            metadata = dict(private_package_metadata())
            metadata["visibility"] = visibility
            cases.append(
                (
                    visibility,
                    200,
                    encoded(metadata),
                )
            )
        wrong_owner = copy.deepcopy(private_package_metadata())
        wrong_owner["owner"]["login"] = "foreign-owner"
        cases.append(("wrong-owner", 200, encoded(wrong_owner)))
        wrong_owner_type = copy.deepcopy(
            private_package_metadata()
        )
        wrong_owner_type["owner"]["type"] = "Organization"
        cases.append(
            (
                "wrong-owner-type",
                200,
                encoded(wrong_owner_type),
            )
        )
        wrong_repository = copy.deepcopy(
            private_package_metadata()
        )
        wrong_repository["repository"]["full_name"] = (
            "moodworks/foreign"
        )
        cases.append(
            (
                "wrong-repository",
                200,
                encoded(wrong_repository),
            )
        )
        wrong_repository_owner = copy.deepcopy(
            private_package_metadata()
        )
        wrong_repository_owner["repository"]["owner"]["id"] = 404
        cases.append(
            (
                "wrong-repository-owner",
                200,
                encoded(wrong_repository_owner),
            )
        )
        cases.extend(
            (
                ("forbidden", 403, b"{}"),
                ("http-failure", 503, b"{}"),
                ("malformed", 200, b"{"),
            )
        )
        for case, status, body in cases:
            with self.subTest(case=case):
                scenario = Scenario(
                    package_status=status,
                    package_body=body,
                )
                result, files, hits = self._run(
                    scenario,
                    "package-preflight",
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(hits, ["package"])
                self.assertEqual(
                    files["github-output"],
                    "",
                )
                self.assert_no_token_disclosure(result, files)


class RegistryTokenUnitTests(unittest.TestCase):
    def test_declared_content_length_must_match_bytes_read(self) -> None:
        class Headers:
            def get_all(self, name: str) -> list[str]:
                self_name = name.lower()
                return ["4"] if self_name == "content-length" else []

        class Response:
            headers = Headers()

            def read(self, _maximum: int) -> bytes:
                return b"abc"

        with self.assertRaises(PublicationError):
            _read_bounded_response(
                Response(),
                100,
                "fixture-http",
            )

    def test_parser_rejects_unexpected_or_ambiguous_envelopes(self) -> None:
        values = (
            b"",
            b"[]",
            b'{"token":"a","token":"a"}',
            encoded({"token": REGISTRY_TOKEN, "foreign": None}),
            encoded(
                {
                    "access_token": "foreign",
                    "token": REGISTRY_TOKEN,
                }
            ),
            encoded({"token": "contains space"}),
            encoded({"expires_in": True, "token": REGISTRY_TOKEN}),
        )
        for index, value in enumerate(values):
            with self.subTest(case=index):
                with self.assertRaises(PublicationError):
                    parse_registry_token(value)


if __name__ == "__main__":
    unittest.main()
