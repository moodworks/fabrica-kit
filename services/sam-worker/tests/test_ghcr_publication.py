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
    CONFIG_BLOB_REDIRECT_HOST,
    HttpResponse,
    PublicationError,
    _config_blob_redirect_location,
    _read_bounded_response,
    parse_registry_token,
)
from image_manifest import (
    EXPECTED_IMAGE_LABELS,
    EXPECTED_RUNTIME_ENVIRONMENT,
    EXPECTED_RUNTIME_MATERIALIZED_HISTORY_SUFFIX,
    OCI_IMAGE_CONFIG,
    OCI_IMAGE_MANIFEST,
)

ROOT = Path(__file__).resolve().parents[3]
CLI = ROOT / "services/sam-worker/ghcr_publication.py"
SOURCE_COMMIT = "e3bb2eea5fe251e30e7541aa80768d004a1ffb14"
GITHUB_TOKEN = "synthetic-github-token-never-emit"
REGISTRY_TOKEN = "synthetic-registry-token-never-emit"
ANONYMOUS_TOKEN = "synthetic-anonymous-token-never-emit"
WRONG_ANONYMOUS_TOKEN = (
    "synthetic-wrong-anonymous-token-never-emit"
)
SIGNED_URL_SECRET = "synthetic-signed-url-never-emit"
REDIRECT_BODY_SECRET = "synthetic-redirect-body-never-emit"


def encoded(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def digest(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def manifest_for_config(config: bytes) -> bytes:
    layers = [
        ("provider-free-layer-%d" % index).encode("ascii")
        for index in range(
            len(EXPECTED_RUNTIME_MATERIALIZED_HISTORY_SUFFIX)
        )
    ]
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
                for layer in layers
            ],
            "mediaType": OCI_IMAGE_MANIFEST,
            "schemaVersion": 2,
        }
    )
    return manifest


def image_fixture() -> tuple[bytes, bytes]:
    config = encoded(
        {
            "architecture": "amd64",
            "config": {
                "Cmd": ["python", "-m", "sam_worker.server"],
                "Env": [
                    "%s=%s" % item
                    for item in sorted(
                        EXPECTED_RUNTIME_ENVIRONMENT.items()
                    )
                ],
                "ExposedPorts": {"80/tcp": {}},
                "Healthcheck": {"Test": ["NONE"]},
                "Labels": {
                    **EXPECTED_IMAGE_LABELS,
                    "org.opencontainers.image.revision": SOURCE_COMMIT,
                },
                "User": "10001:10001",
                "WorkingDir": "/opt/fabrica/worker",
            },
            "history": [
                {"created_by": marker}
                for marker in (
                    EXPECTED_RUNTIME_MATERIALIZED_HISTORY_SUFFIX
                )
            ],
            "os": "linux",
            "rootfs": {
                "diff_ids": [
                    "sha256:" + ("%064x" % index)
                    for index in range(
                        1,
                        len(
                            EXPECTED_RUNTIME_MATERIALIZED_HISTORY_SUFFIX
                        )
                        + 1,
                    )
                ],
                "type": "layers",
            },
        }
    )
    return manifest_for_config(config), config


def public_package_metadata() -> Mapping[str, Any]:
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
        "visibility": "public",
    }


def owner_metadata() -> Mapping[str, Any]:
    return {
        "id": 202,
        "login": "moodworks",
        "type": "User",
    }


@dataclass
class Scenario:
    owner_status: int = 200
    owner_body: bytes = field(
        default_factory=lambda: encoded(owner_metadata())
    )
    package_status: int = 200
    package_body: bytes = field(
        default_factory=lambda: encoded(public_package_metadata())
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
    anonymous_token_status: int = 200
    anonymous_token_body: bytes = field(
        default_factory=lambda: encoded(
            {
                "expires_in": 300,
                "issued_at": "2026-07-20T00:00:00Z",
                "token": ANONYMOUS_TOKEN,
            }
        )
    )
    manifest: bytes = field(
        default_factory=lambda: image_fixture()[0]
    )
    config: bytes = field(
        default_factory=lambda: image_fixture()[1]
    )
    config_redirect_status: int | None = None
    config_redirect_case: str = "valid"
    config_redirect_body: bytes = REDIRECT_BODY_SECRET.encode(
        "ascii"
    )
    config_terminal_status: int = 200
    config_terminal_body: bytes | None = None
    config_terminal_content_length: int | None = None
    config_terminal_redirect_case: str | None = None
    direct_public_manifest: bool = False
    direct_public_tag: bool = False
    tag_digest_header: str | None = None
    challenge_case: str = "valid"
    anonymous_bearer_status: int = 200
    anonymous_bearer_body: bytes | None = None
    latest_status: int = 404
    registry_base_url: str = ""
    blob_base_url: str = ""
    hits: list[str] = field(default_factory=list)


class FixtureServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, scenario: Scenario, role: str) -> None:
        self.scenario = scenario
        self.role = role
        super().__init__(("127.0.0.1", 0), FixtureHandler)


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
        content_length: int | None = None,
        extra_headers: tuple[tuple[str, str], ...] = (),
    ) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header(
            "Content-Length",
            str(
                len(body)
                if content_length is None
                else content_length
            ),
        )
        if content_digest is not None:
            self.send_header(
                "Docker-Content-Digest",
                content_digest,
            )
        for name, value in extra_headers:
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urllib.parse.urlsplit(self.path)
        scenario = self.server.scenario
        if self.server.role == "blob":
            self._handle_config_blob(parsed)
            return
        package_path = (
            "/users/moodworks/packages/container/"
            "fabrica-sam-worker"
        )
        if parsed.path == "/users/moodworks":
            scenario.hits.append("owner-auth")
            if (
                self.headers.get("Authorization")
                != "Bearer " + GITHUB_TOKEN
            ):
                self._send(401, b"{}")
                return
            self._send(
                scenario.owner_status,
                scenario.owner_body,
            )
            return
        if parsed.path == package_path:
            scenario.hits.append("package-auth")
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
            expected_basic = "Basic " + base64.b64encode(
                ("fixture-actor:" + GITHUB_TOKEN).encode("utf-8")
            ).decode("ascii")
            authorization = self.headers.get("Authorization")
            if authorization == expected_basic:
                scenario.hits.append("token-auth")
                self._send(
                    scenario.token_status,
                    scenario.token_body,
                )
                return
            if authorization is None:
                scenario.hits.append("token-anon")
                query = urllib.parse.parse_qs(
                    parsed.query,
                    keep_blank_values=True,
                    strict_parsing=True,
                )
                if query != {
                    "scope": [
                        (
                            "repository:moodworks/"
                            "fabrica-sam-worker:pull"
                        )
                    ],
                    "service": ["ghcr.io"],
                }:
                    self._send(400, b"{}")
                    return
                self._send(
                    scenario.anonymous_token_status,
                    scenario.anonymous_token_body,
                )
                return
            scenario.hits.append("token-foreign-auth")
            self._send(401, b"{}")
            return

        manifest_digest = digest(scenario.manifest)
        tag_path = (
            "/v2/moodworks/fabrica-sam-worker/manifests/"
            + SOURCE_COMMIT
        )
        if parsed.path == tag_path:
            authorization = self.headers.get("Authorization")
            returned_digest = (
                manifest_digest
                if scenario.tag_digest_header is None
                else scenario.tag_digest_header
            )
            if authorization is None:
                scenario.hits.append("tag-anon-initial")
                if scenario.direct_public_tag:
                    self._send(
                        200,
                        scenario.manifest,
                        content_type=OCI_IMAGE_MANIFEST,
                        content_digest=returned_digest,
                    )
                    return
                challenge = (
                    'Bearer realm="%s/token",service="ghcr.io",'
                    'scope="repository:moodworks/'
                    'fabrica-sam-worker:pull"'
                    % scenario.registry_base_url
                )
                self._send(
                    401,
                    b"{}",
                    extra_headers=(
                        ("WWW-Authenticate", challenge),
                    ),
                )
                return
            if authorization == "Bearer " + ANONYMOUS_TOKEN:
                scenario.hits.append("tag-anon-bearer")
                self._send(
                    200,
                    scenario.manifest,
                    content_type=OCI_IMAGE_MANIFEST,
                    content_digest=returned_digest,
                )
                return
            scenario.hits.append("tag-foreign-auth")
            self._send(401, b"{}")
            return

        manifest_path = (
            "/v2/moodworks/fabrica-sam-worker/manifests/"
            + manifest_digest
        )
        if parsed.path == manifest_path:
            authorization = self.headers.get("Authorization")
            if authorization == "Bearer " + REGISTRY_TOKEN:
                scenario.hits.append("manifest-auth")
                self._send(
                    200,
                    scenario.manifest,
                    content_type=OCI_IMAGE_MANIFEST,
                    content_digest=manifest_digest,
                )
                return
            if authorization is None:
                scenario.hits.append("manifest-anon-initial")
                if scenario.direct_public_manifest:
                    self._send(
                        200,
                        scenario.manifest,
                        content_type=OCI_IMAGE_MANIFEST,
                        content_digest=manifest_digest,
                    )
                    return
                realm = (
                    "http://127.0.0.1:%d/token"
                    % self.server.server_address[1]
                )
                valid_challenge = (
                    'Bearer realm="%s",service="ghcr.io",'
                    'scope="repository:moodworks/'
                    'fabrica-sam-worker:pull"' % realm
                )
                challenge_values = {
                    "valid": (valid_challenge,),
                    "wrong-realm": (
                        valid_challenge.replace(
                            realm,
                            "https://example.invalid/token",
                        ),
                    ),
                    "wrong-service": (
                        valid_challenge.replace(
                            'service="ghcr.io"',
                            'service="registry.example"',
                        ),
                    ),
                    "wrong-scope": (
                        valid_challenge.replace(
                            (
                                'scope="repository:moodworks/'
                                'fabrica-sam-worker:pull"'
                            ),
                            (
                                'scope="repository:moodworks/'
                                'fabrica-sam-worker:push"'
                            ),
                        ),
                    ),
                    "unknown-parameter": (
                        valid_challenge + ',foreign="value"',
                    ),
                    "duplicate-parameter": (
                        valid_challenge
                        + (',service="ghcr.io"'),
                    ),
                    "missing-parameter": (
                        'Bearer realm="%s",service="ghcr.io"'
                        % realm,
                    ),
                    "malformed": (
                        'Bearer realm="%s,service="ghcr.io"'
                        % realm,
                    ),
                    "wrong-scheme": (
                        valid_challenge.replace(
                            "Bearer ",
                            "Basic ",
                        ),
                    ),
                    "missing": (),
                    "multiple-headers": (
                        valid_challenge,
                        valid_challenge,
                    ),
                }.get(scenario.challenge_case, ())
                self._send(
                    401,
                    b"{}",
                    extra_headers=tuple(
                        (
                            "WWW-Authenticate",
                            value,
                        )
                        for value in challenge_values
                    ),
                )
                return
            if authorization == "Bearer " + ANONYMOUS_TOKEN:
                scenario.hits.append("manifest-anon-bearer")
                body = (
                    scenario.manifest
                    if scenario.anonymous_bearer_body is None
                    else scenario.anonymous_bearer_body
                )
                self._send(
                    scenario.anonymous_bearer_status,
                    body,
                    content_type=OCI_IMAGE_MANIFEST,
                    content_digest=manifest_digest,
                )
                return
            scenario.hits.append("manifest-foreign-auth")
            self._send(401, b"{}")
            return

        config_digest = digest(scenario.config)
        if parsed.path == (
            "/v2/moodworks/fabrica-sam-worker/blobs/"
            + config_digest
        ):
            authorization = self.headers.get("Authorization")
            if authorization == "Bearer " + REGISTRY_TOKEN:
                scenario.hits.append("config-auth")
            elif authorization == "Bearer " + ANONYMOUS_TOKEN:
                scenario.hits.append("config-anon")
            else:
                scenario.hits.append("config-foreign-auth")
                self._send(401, b"{}")
                return
            if scenario.config_redirect_status is not None:
                if scenario.config_redirect_case == "valid":
                    location = (
                        scenario.blob_base_url
                        + "/signed-config?signature="
                        + SIGNED_URL_SECRET
                    )
                    headers = (("Location", location),)
                elif scenario.config_redirect_case == "downgrade":
                    location = (
                        "http://"
                        + CONFIG_BLOB_REDIRECT_HOST
                        + "/signed-config?signature="
                        + SIGNED_URL_SECRET
                    )
                    headers = (("Location", location),)
                else:
                    headers = ()
                self._send(
                    scenario.config_redirect_status,
                    scenario.config_redirect_body,
                    extra_headers=headers,
                )
                return
            body = (
                scenario.config
                if scenario.config_terminal_body is None
                else scenario.config_terminal_body
            )
            self._send(
                scenario.config_terminal_status,
                body,
                content_type="application/octet-stream",
                content_length=(
                    scenario.config_terminal_content_length
                ),
            )
            return

        if parsed.path == (
            "/v2/moodworks/fabrica-sam-worker/manifests/latest"
        ):
            if (
                self.headers.get("Authorization")
                == "Bearer " + ANONYMOUS_TOKEN
            ):
                scenario.hits.append("latest-anon-bearer")
                self._send(scenario.latest_status, b"{}")
                return
            scenario.hits.append("latest-foreign-auth")
            self._send(401, b"{}")
            return

        scenario.hits.append("foreign")
        self._send(404, b"{}")

    def _handle_config_blob(
        self,
        parsed: urllib.parse.SplitResult,
    ) -> None:
        scenario = self.server.scenario
        if (
            parsed.path != "/signed-config"
            or parsed.query
            != "signature=" + SIGNED_URL_SECRET
        ):
            scenario.hits.append("config-redirect-foreign")
            self._send(404, b"{}")
            return
        if self.headers.get("Authorization") is not None:
            scenario.hits.append("config-redirect-target-auth")
            self._send(401, b"{}")
            return
        scenario.hits.append("config-redirect-target")
        if scenario.config_terminal_redirect_case is not None:
            if scenario.config_terminal_redirect_case == "loop":
                location = (
                    scenario.blob_base_url
                    + "/signed-config?signature="
                    + SIGNED_URL_SECRET
                )
            else:
                location = (
                    scenario.blob_base_url
                    + "/signed-config-second?signature="
                    + SIGNED_URL_SECRET
                )
            self._send(
                307,
                scenario.config_redirect_body,
                extra_headers=(("Location", location),),
            )
            return
        body = (
            scenario.config
            if scenario.config_terminal_body is None
            else scenario.config_terminal_body
        )
        self._send(
            scenario.config_terminal_status,
            body,
            content_type="application/octet-stream",
            content_length=scenario.config_terminal_content_length,
        )


class GhcrPublicationEntrypointTests(unittest.TestCase):
    def _run(
        self,
        scenario: Scenario,
        *,
        include_github_token: bool = True,
        anonymous: bool = False,
    ) -> tuple[
        subprocess.CompletedProcess[str],
        Mapping[str, str],
        list[str],
    ]:
        blob_server = FixtureServer(scenario, "blob")
        server = FixtureServer(scenario, "registry")
        scenario.blob_base_url = (
            "http://127.0.0.1:%d"
            % blob_server.server_address[1]
        )
        scenario.registry_base_url = (
            "http://127.0.0.1:%d"
            % server.server_address[1]
        )
        blob_thread = threading.Thread(
            target=blob_server.serve_forever,
            kwargs={"poll_interval": 0.01},
            daemon=True,
        )
        thread = threading.Thread(
            target=server.serve_forever,
            kwargs={"poll_interval": 0.01},
            daemon=True,
        )
        blob_thread.start()
        thread.start()
        try:
            base_url = scenario.registry_base_url
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                github_output = root / "github-output"
                step_summary = root / "step-summary"
                github_output.write_text("", encoding="utf-8")
                step_summary.write_text("", encoding="utf-8")
                environment = dict(os.environ)
                environment.pop("GITHUB_TOKEN", None)
                environment.pop("GITHUB_ACTOR", None)
                environment["PYTHONDONTWRITEBYTECODE"] = "1"
                if not anonymous:
                    environment["GITHUB_ACTOR"] = "fixture-actor"
                if include_github_token:
                    environment["GITHUB_TOKEN"] = GITHUB_TOKEN
                command = [
                    sys.executable,
                    str(CLI),
                    "--allow-loopback-test-endpoints",
                    "--github-api-base-url",
                    base_url,
                    "--registry-api-base-url",
                    base_url,
                    "--registry-token-url",
                    base_url + "/token",
                ]
                if anonymous:
                    command.extend(
                        [
                            "verify-anonymous-image",
                            "--source-commit",
                            SOURCE_COMMIT,
                            "--github-output",
                            str(github_output),
                            "--step-summary",
                            str(step_summary),
                        ]
                    )
                else:
                    build_metadata = (
                        root / "build-metadata.json"
                    )
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
                    command.extend(
                        [
                            "verify-image",
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
                result = subprocess.run(
                    command,
                    cwd=ROOT,
                    env=environment,
                    capture_output=True,
                    text=True,
                    check=False,
                )
                files = {
                    "github-output": github_output.read_text("utf-8"),
                    "step-summary": step_summary.read_text("utf-8"),
                    "file-inventory": "\n".join(
                        sorted(
                            path.name
                            for path in root.iterdir()
                        )
                    ),
                }
                return result, files, list(scenario.hits)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
            blob_server.shutdown()
            blob_server.server_close()
            blob_thread.join(timeout=5)

    def assert_no_token_disclosure(
        self,
        result: subprocess.CompletedProcess[str],
        files: Mapping[str, str],
    ) -> None:
        values = (
            result.stdout,
            result.stderr,
            *files.values(),
        )
        for value in values:
            self.assertFalse(
                hmac.compare_digest(
                    GITHUB_TOKEN.encode(),
                    value.encode(),
                )
            )
            self.assertNotIn(GITHUB_TOKEN, value)
            self.assertNotIn(REGISTRY_TOKEN, value)
            self.assertNotIn(ANONYMOUS_TOKEN, value)
            self.assertNotIn(WRONG_ANONYMOUS_TOKEN, value)
            self.assertNotIn(SIGNED_URL_SECRET, value)
            self.assertNotIn(REDIRECT_BODY_SECRET, value)

    def assert_failed_without_identity(
        self,
        result: subprocess.CompletedProcess[str],
        files: Mapping[str, str],
    ) -> None:
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(files["github-output"], "")
        self.assertEqual(files["step-summary"], "")
        self.assert_no_token_disclosure(result, files)

    def test_public_exact_manifest_success_is_emitted_only_after_all_proofs(
        self,
    ) -> None:
        scenario = Scenario()
        result, files, hits = self._run(scenario)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertEqual(
            hits,
            [
                "owner-auth",
                "package-auth",
                "token-auth",
                "manifest-auth",
                "config-auth",
                "manifest-anon-initial",
                "token-anon",
                "manifest-anon-bearer",
                "latest-anon-bearer",
            ],
        )
        manifest_digest = digest(scenario.manifest)
        self.assertIn(
            (
                "image_reference=ghcr.io/moodworks/"
                "fabrica-sam-worker@"
                + manifest_digest
            ),
            files["github-output"],
        )
        self.assertIn(
            "platform_manifest_digest=" + manifest_digest,
            files["github-output"],
        )
        self.assertIn(
            "package_visibility=public",
            files["github-output"],
        )
        self.assertIn(
            (
                "anonymous_manifest_proof="
                "registry-v2-anonymous-exact-digest-http-200"
            ),
            files["github-output"],
        )
        self.assertIn(
            (
                "anonymous_latest_proof="
                "registry-v2-anonymous-bearer-http-404"
            ),
            files["github-output"],
        )
        self.assertIn(
            "Verified public SAM worker image identity",
            files["step-summary"],
        )
        self.assertIn(
            "no layer-tar byte claim",
            files["step-summary"],
        )
        self.assertEqual(
            files["file-inventory"],
            (
                "build-metadata.json\n"
                "github-output\n"
                "step-summary"
            ),
        )
        self.assert_no_token_disclosure(result, files)

    def test_config_blob_direct_200_remains_supported(self) -> None:
        scenario = Scenario()
        result, files, hits = self._run(scenario)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("config-auth", hits)
        self.assertNotIn("config-redirect-target", hits)
        self.assert_no_token_disclosure(result, files)

    def test_config_blob_302_and_307_strip_cross_origin_auth(
        self,
    ) -> None:
        for status in (302, 307):
            with self.subTest(status=status):
                scenario = Scenario(
                    config_redirect_status=status,
                )
                result, files, hits = self._run(scenario)
                self.assertEqual(
                    result.returncode,
                    0,
                    result.stderr,
                )
                self.assertIn("config-auth", hits)
                self.assertIn(
                    "config-redirect-target",
                    hits,
                )
                self.assertNotIn(
                    "config-redirect-target-auth",
                    hits,
                )
                self.assert_no_token_disclosure(result, files)

    def test_config_blob_signed_url_is_redacted_on_failure(
        self,
    ) -> None:
        scenario = Scenario(
            config_redirect_status=307,
            config_terminal_status=503,
        )
        result, files, hits = self._run(scenario)
        self.assertEqual(
            hits[-1],
            "config-redirect-target",
        )
        self.assertIn("registry-config-http", result.stderr)
        self.assert_failed_without_identity(result, files)

    def test_config_blob_redirect_loop_and_limit_fail_closed(
        self,
    ) -> None:
        for case, code in (
            ("loop", "registry-config-redirect-loop"),
            ("limit", "registry-config-redirect-limit"),
        ):
            with self.subTest(case=case):
                scenario = Scenario(
                    config_redirect_status=307,
                    config_terminal_redirect_case=case,
                )
                result, files, hits = self._run(scenario)
                self.assertEqual(
                    hits[-1],
                    "config-redirect-target",
                )
                self.assertIn(code, result.stderr)
                self.assert_failed_without_identity(
                    result,
                    files,
                )

    def test_config_blob_redirect_location_is_mandatory_and_secure(
        self,
    ) -> None:
        for case in ("missing", "downgrade"):
            with self.subTest(case=case):
                scenario = Scenario(
                    config_redirect_status=307,
                    config_redirect_case=case,
                )
                result, files, hits = self._run(scenario)
                self.assertEqual(hits[-1], "config-auth")
                self.assertIn(
                    "registry-config-redirect-location",
                    result.stderr,
                )
                self.assertNotIn(
                    "config-redirect-target",
                    hits,
                )
                self.assert_failed_without_identity(
                    result,
                    files,
                )

    def test_config_blob_terminal_status_must_be_200(
        self,
    ) -> None:
        for status in (401, 404, 503):
            with self.subTest(status=status):
                scenario = Scenario(
                    config_redirect_status=302,
                    config_terminal_status=status,
                )
                result, files, hits = self._run(scenario)
                self.assertEqual(
                    hits[-1],
                    "config-redirect-target",
                )
                self.assertIn(
                    "registry-config-http",
                    result.stderr,
                )
                self.assert_failed_without_identity(
                    result,
                    files,
                )

    def test_config_blob_truncated_and_oversized_bodies_fail_closed(
        self,
    ) -> None:
        _manifest, config = image_fixture()
        cases = (
            (
                "truncated",
                config[:-1],
                len(config),
            ),
            (
                "oversized",
                config + b"x",
                None,
            ),
        )
        for case, body, content_length in cases:
            with self.subTest(case=case):
                scenario = Scenario(
                    config_redirect_status=307,
                    config_terminal_body=body,
                    config_terminal_content_length=(
                        content_length
                    ),
                )
                result, files, hits = self._run(scenario)
                self.assertEqual(
                    hits[-1],
                    "config-redirect-target",
                )
                self.assertIn(
                    "registry-config-http",
                    result.stderr,
                )
                self.assert_failed_without_identity(
                    result,
                    files,
                )

    def test_config_blob_digest_mismatch_precedes_json_parse(
        self,
    ) -> None:
        _manifest, config = image_fixture()
        changed = b"[" + config[1:]
        self.assertEqual(len(changed), len(config))
        scenario = Scenario(
            config_redirect_status=307,
            config_terminal_body=changed,
        )
        result, files, hits = self._run(scenario)
        self.assertEqual(
            hits[-1],
            "config-redirect-target",
        )
        self.assertIn("image-identity", result.stderr)
        self.assert_failed_without_identity(result, files)

    def test_config_blob_malformed_json_and_labels_fail_closed(
        self,
    ) -> None:
        malformed = b"{"
        _default_manifest, default_config = image_fixture()
        values = json.loads(default_config)
        wrong_source = copy.deepcopy(values)
        wrong_source["config"]["Labels"][
            "org.opencontainers.image.revision"
        ] = "a" * 40
        wrong_identity = copy.deepcopy(values)
        wrong_identity["config"]["Labels"][
            "io.fabrica.sam.hosting-profile-sha256"
        ] = "0" * 64
        cases = (
            ("malformed", malformed),
            ("source", encoded(wrong_source)),
            ("identity-label", encoded(wrong_identity)),
        )
        for case, config in cases:
            with self.subTest(case=case):
                scenario = Scenario(
                    manifest=manifest_for_config(config),
                    config=config,
                    config_redirect_status=307,
                )
                result, files, hits = self._run(scenario)
                self.assertEqual(
                    hits[-1],
                    "config-redirect-target",
                )
                self.assertIn(
                    "image-identity",
                    result.stderr,
                )
                self.assert_failed_without_identity(
                    result,
                    files,
                )

    def test_anonymous_existing_image_requires_no_github_credential(
        self,
    ) -> None:
        scenario = Scenario(config_redirect_status=307)
        result, files, hits = self._run(
            scenario,
            include_github_token=False,
            anonymous=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            hits,
            [
                "tag-anon-initial",
                "token-anon",
                "tag-anon-bearer",
                "config-anon",
                "config-redirect-target",
                "manifest-anon-initial",
                "token-anon",
                "manifest-anon-bearer",
                "latest-anon-bearer",
            ],
        )
        self.assertNotIn("package_visibility", files["github-output"])
        self.assertIn(
            "Package API ownership/linkage: not evaluated",
            files["step-summary"],
        )
        self.assertEqual(
            files["file-inventory"],
            "github-output\nstep-summary",
        )
        self.assert_no_token_disclosure(result, files)

    def test_anonymous_tag_digest_header_is_untrusted(
        self,
    ) -> None:
        scenario = Scenario(
            tag_digest_header=digest(b"foreign-root"),
        )
        result, files, hits = self._run(
            scenario,
            include_github_token=False,
            anonymous=True,
        )
        self.assertEqual(
            hits,
            [
                "tag-anon-initial",
                "token-anon",
                "tag-anon-bearer",
            ],
        )
        self.assertIn("image-identity", result.stderr)
        self.assert_failed_without_identity(result, files)

    def test_direct_public_manifest_is_reproven_with_anonymous_bearer(
        self,
    ) -> None:
        scenario = Scenario(direct_public_manifest=True)
        result, files, hits = self._run(scenario)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            hits[-4:],
            [
                "manifest-anon-initial",
                "token-anon",
                "manifest-anon-bearer",
                "latest-anon-bearer",
            ],
        )
        self.assert_no_token_disclosure(result, files)

    def test_package_must_be_exact_public_user_owned_and_linked(
        self,
    ) -> None:
        cases: list[tuple[str, int, bytes]] = []
        for visibility in ("private", "internal"):
            metadata = dict(public_package_metadata())
            metadata["visibility"] = visibility
            cases.append(
                (visibility, 200, encoded(metadata))
            )
        wrong_owner = copy.deepcopy(public_package_metadata())
        wrong_owner["owner"]["login"] = "foreign-owner"
        cases.append(("wrong-owner", 200, encoded(wrong_owner)))
        wrong_owner_type = copy.deepcopy(public_package_metadata())
        wrong_owner_type["owner"]["type"] = "Organization"
        cases.append(
            ("wrong-owner-type", 200, encoded(wrong_owner_type))
        )
        wrong_owner_id = copy.deepcopy(public_package_metadata())
        wrong_owner_id["repository"]["owner"]["id"] = 404
        cases.append(
            ("wrong-owner-id", 200, encoded(wrong_owner_id))
        )
        wrong_package_owner_id = copy.deepcopy(
            public_package_metadata()
        )
        wrong_package_owner_id["owner"]["id"] = 404
        wrong_package_owner_id["repository"]["owner"]["id"] = 404
        cases.append(
            (
                "wrong-package-owner-id",
                200,
                encoded(wrong_package_owner_id),
            )
        )
        wrong_repository = copy.deepcopy(public_package_metadata())
        wrong_repository["repository"]["full_name"] = (
            "moodworks/foreign"
        )
        cases.append(
            ("wrong-repository", 200, encoded(wrong_repository))
        )
        cases.extend(
            (
                ("absent", 404, b"{}"),
                ("forbidden", 403, b"{}"),
                ("malformed", 200, b"{"),
            )
        )
        for case, status, body in cases:
            with self.subTest(case=case):
                scenario = Scenario(
                    package_status=status,
                    package_body=body,
                )
                result, files, hits = self._run(scenario)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(
                    hits,
                    ["owner-auth", "package-auth"],
                )
                self.assertEqual(files["github-output"], "")
                self.assertEqual(files["step-summary"], "")
                self.assert_no_token_disclosure(result, files)

    def test_anonymous_bearer_manifest_must_repeat_raw_identity_proof(
        self,
    ) -> None:
        cases = (
            ("not-public", 401, None),
            ("changed-bytes", 200, b'{"changed":true}'),
        )
        for case, status, body in cases:
            with self.subTest(case=case):
                scenario = Scenario(
                    anonymous_bearer_status=status,
                    anonymous_bearer_body=body,
                )
                result, files, hits = self._run(scenario)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(
                    hits[-1],
                    "manifest-anon-bearer",
                )
                self.assertNotIn("latest-anon-bearer", hits)
                self.assertEqual(files["github-output"], "")
                self.assertEqual(files["step-summary"], "")
                self.assert_no_token_disclosure(result, files)

    def test_anonymous_bearer_challenge_is_exact_and_closed(
        self,
    ) -> None:
        for challenge_case in (
            "wrong-realm",
            "wrong-service",
            "wrong-scope",
            "unknown-parameter",
            "duplicate-parameter",
            "missing-parameter",
            "malformed",
            "wrong-scheme",
            "missing",
            "multiple-headers",
        ):
            with self.subTest(challenge_case=challenge_case):
                scenario = Scenario(
                    challenge_case=challenge_case,
                )
                result, files, hits = self._run(scenario)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(
                    hits[-1],
                    "manifest-anon-initial",
                )
                self.assertNotIn("token-anon", hits)
                self.assertIn(
                    "anonymous-bearer-challenge",
                    result.stderr,
                )
                self.assertEqual(files["github-output"], "")
                self.assertEqual(files["step-summary"], "")
                self.assert_no_token_disclosure(result, files)

    def test_anonymous_token_http_and_envelope_fail_closed(
        self,
    ) -> None:
        cases = (
            ("http", 503, encoded({"token": ANONYMOUS_TOKEN})),
            ("empty", 200, b""),
            ("duplicate", 200, b'{"token":"a","token":"b"}'),
            (
                "unknown",
                200,
                encoded(
                    {
                        "token": ANONYMOUS_TOKEN,
                        "foreign": True,
                    }
                ),
            ),
        )
        for case, status, body in cases:
            with self.subTest(case=case):
                scenario = Scenario(
                    anonymous_token_status=status,
                    anonymous_token_body=body,
                )
                result, files, hits = self._run(scenario)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(hits[-1], "token-anon")
                self.assertNotIn("manifest-anon-bearer", hits)
                self.assertIn(
                    (
                        "anonymous-token-http"
                        if case == "http"
                        else "anonymous-token-envelope"
                    ),
                    result.stderr,
                )
                self.assertEqual(files["github-output"], "")
                self.assertEqual(files["step-summary"], "")
                self.assert_no_token_disclosure(result, files)

    def test_wrong_anonymous_token_is_never_replaced_by_github_auth(
        self,
    ) -> None:
        scenario = Scenario(
            anonymous_token_body=encoded(
                {"token": WRONG_ANONYMOUS_TOKEN}
            )
        )
        result, files, hits = self._run(scenario)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(hits[-1], "manifest-foreign-auth")
        self.assertNotIn("latest-anon-bearer", hits)
        self.assertIn(
            "anonymous-platform-bearer-http",
            result.stderr,
        )
        self.assertEqual(files["github-output"], "")
        self.assertEqual(files["step-summary"], "")
        self.assert_no_token_disclosure(result, files)

    def test_anonymous_latest_must_be_exact_bearer_http_404(
        self,
    ) -> None:
        for status in (200, 401):
            with self.subTest(status=status):
                scenario = Scenario(latest_status=status)
                result, files, hits = self._run(scenario)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(
                    hits[-1],
                    "latest-anon-bearer",
                )
                self.assertEqual(files["github-output"], "")
                self.assertEqual(files["step-summary"], "")
                self.assertIn(
                    "anonymous-latest-bearer-http",
                    result.stderr,
                )
                self.assert_no_token_disclosure(result, files)

    def test_token_envelope_failure_is_sanitized_and_in_memory_only(
        self,
    ) -> None:
        bodies = (
            b"",
            b"[]",
            b'{"token":"a","token":"b"}',
            encoded({"token": REGISTRY_TOKEN, "foreign": True}),
            encoded(
                {
                    "access_token": "different",
                    "token": REGISTRY_TOKEN,
                }
            ),
        )
        for index, body in enumerate(bodies):
            with self.subTest(case=index):
                scenario = Scenario(token_body=body)
                result, files, hits = self._run(scenario)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(
                    hits,
                    [
                        "owner-auth",
                        "package-auth",
                        "token-auth",
                    ],
                )
                self.assertIn(
                    "registry-token-envelope",
                    result.stderr,
                )
                self.assert_no_token_disclosure(result, files)

    def test_missing_github_token_fails_before_any_request(self) -> None:
        scenario = Scenario()
        result, files, hits = self._run(
            scenario,
            include_github_token=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(hits, [])
        self.assertIn("github-token-missing", result.stderr)
        self.assert_no_token_disclosure(result, files)

    def test_owner_login_type_and_id_are_exactly_cross_bound(
        self,
    ) -> None:
        cases = (
            {"id": 202, "login": "foreign", "type": "User"},
            {
                "id": 202,
                "login": "moodworks",
                "type": "Organization",
            },
            {"id": 0, "login": "moodworks", "type": "User"},
        )
        for metadata in cases:
            with self.subTest(metadata=metadata):
                scenario = Scenario(
                    owner_body=encoded(metadata),
                )
                result, files, hits = self._run(scenario)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(hits, ["owner-auth"])
                self.assertEqual(files["github-output"], "")
                self.assertEqual(files["step-summary"], "")
                self.assert_no_token_disclosure(result, files)


class RegistryTokenUnitTests(unittest.TestCase):
    def test_production_config_redirect_requires_exact_https_host(
        self,
    ) -> None:
        valid = (
            "https://"
            + CONFIG_BLOB_REDIRECT_HOST
            + "/signed-config?signature="
            + SIGNED_URL_SECRET
        )
        response = HttpResponse(
            status=307,
            headers=(("Location", valid),),
            body=b"",
        )
        self.assertEqual(
            _config_blob_redirect_location(
                response,
                "https://ghcr.io",
            ),
            valid,
        )
        for location in (
            valid.replace("https://", "http://", 1),
            valid.replace(
                CONFIG_BLOB_REDIRECT_HOST,
                "example.invalid",
            ),
            valid.replace(
                "https://",
                "https://user@example.invalid@",
                1,
            ),
            valid.split("?", 1)[0],
            valid + "#fragment",
        ):
            with self.subTest(location=location):
                with self.assertRaisesRegex(
                    PublicationError,
                    "registry-config-redirect-location",
                ):
                    _config_blob_redirect_location(
                        HttpResponse(
                            status=302,
                            headers=(
                                ("Location", location),
                            ),
                            body=b"",
                        ),
                        "https://ghcr.io",
                    )

    def test_declared_content_length_must_match_bytes_read(self) -> None:
        class Headers:
            def get_all(self, name: str) -> list[str]:
                return (
                    ["4"]
                    if name.lower() == "content-length"
                    else []
                )

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
