#!/usr/bin/env python3
"""Fail-closed public GHCR package and worker image verification."""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

from image_manifest import (
    IMAGE_MANIFEST_MEDIA_TYPES,
    ImageManifestError,
    inspect_platform_manifest,
    resolve_root,
    validate_digest,
    validate_root_platform_relationship,
    verify_linux_amd64_config,
)

EXPECTED_OWNER = "moodworks"
EXPECTED_REPOSITORY = "fabrica-kit"
EXPECTED_REPOSITORY_FULL_NAME = "moodworks/fabrica-kit"
EXPECTED_PACKAGE = "fabrica-sam-worker"
EXPECTED_IMAGE_REPOSITORY = "ghcr.io/moodworks/fabrica-sam-worker"
GITHUB_API_BASE_URL = "https://api.github.com"
REGISTRY_API_BASE_URL = "https://ghcr.io"
REGISTRY_TOKEN_URL = "https://ghcr.io/token"
GITHUB_API_VERSION = "2022-11-28"
COMMIT_PATTERN = re.compile(r"[0-9a-f]{40}")
ACTOR_PATTERN = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})")
TOKEN_PATTERN = re.compile(r"[\x21-\x7e]{1,16384}")
OUTPUT_KEY_PATTERN = re.compile(r"[a-z0-9_]+")
MAX_TOKEN_ENVELOPE_BYTES = 64_000
MAX_PACKAGE_METADATA_BYTES = 1_000_000
MAX_REGISTRY_DOCUMENT_BYTES = 4_000_000


class PublicationError(RuntimeError):
    """A sanitized GHCR publication boundary failure."""

    def __init__(self, code: str) -> None:
        if re.fullmatch(r"[a-z0-9-]+", code) is None:
            code = "internal-boundary"
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class HttpResponse:
    status: int
    headers: tuple[tuple[str, str], ...]
    body: bytes


class _RejectRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(
        self,
        request: urllib.request.Request,
        file_pointer: Any,
        code: int,
        message: str,
        headers: Mapping[str, str],
        new_url: str,
    ) -> None:
        return None


def _strict_json_object(
    data: bytes,
    *,
    maximum_bytes: int,
    error_code: str,
) -> Mapping[str, Any]:
    if not data or len(data) > maximum_bytes:
        raise PublicationError(error_code)

    def closed_pairs(pairs: Sequence[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise PublicationError(error_code)
            result[key] = value
        return result

    try:
        value = json.loads(
            data.decode("utf-8", errors="strict"),
            object_pairs_hook=closed_pairs,
            parse_constant=lambda _value: (_ for _ in ()).throw(
                PublicationError(error_code)
            ),
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise PublicationError(error_code) from error
    if not isinstance(value, dict):
        raise PublicationError(error_code)
    return value


def parse_registry_token(data: bytes) -> str:
    """Return one in-memory token from a strict Docker token envelope."""

    envelope = _strict_json_object(
        data,
        maximum_bytes=MAX_TOKEN_ENVELOPE_BYTES,
        error_code="registry-token-envelope",
    )
    if not set(envelope).issubset(
        {"token", "access_token", "expires_in", "issued_at"}
    ):
        raise PublicationError("registry-token-envelope")
    token = envelope.get("token")
    access_token = envelope.get("access_token")
    candidates = [
        value
        for value in (token, access_token)
        if isinstance(value, str) and value
    ]
    if (
        not candidates
        or any(TOKEN_PATTERN.fullmatch(value) is None for value in candidates)
        or (len(candidates) == 2 and candidates[0] != candidates[1])
        or (
            token is not None
            and (not isinstance(token, str) or not token)
        )
        or (
            access_token is not None
            and (
                not isinstance(access_token, str)
                or not access_token
            )
        )
    ):
        raise PublicationError("registry-token-envelope")
    expires_in = envelope.get("expires_in")
    if (
        expires_in is not None
        and (
            isinstance(expires_in, bool)
            or not isinstance(expires_in, int)
            or expires_in < 1
            or expires_in > 86_400
        )
    ):
        raise PublicationError("registry-token-envelope")
    issued_at = envelope.get("issued_at")
    if issued_at is not None and (
        not isinstance(issued_at, str)
        or not issued_at
        or len(issued_at) > 128
        or any(character.isspace() for character in issued_at)
    ):
        raise PublicationError("registry-token-envelope")
    return candidates[0]


def _read_bounded_response(
    response: Any,
    maximum_bytes: int,
    error_code: str,
) -> bytes:
    lengths = response.headers.get_all("Content-Length") or []
    if len(lengths) > 1:
        raise PublicationError(error_code)
    if lengths:
        try:
            length = int(lengths[0], 10)
        except (TypeError, ValueError) as error:
            raise PublicationError(error_code) from error
        if length < 0 or length > maximum_bytes:
            raise PublicationError(error_code)
    data = response.read(maximum_bytes + 1)
    if (
        len(data) > maximum_bytes
        or (lengths and len(data) != length)
    ):
        raise PublicationError(error_code)
    return data


def _http_get(
    url: str,
    *,
    headers: Mapping[str, str],
    maximum_bytes: int,
    accepted_statuses: set[int],
    error_code: str,
) -> HttpResponse:
    request = urllib.request.Request(
        url,
        headers=dict(headers),
        method="GET",
    )
    opener = urllib.request.build_opener(_RejectRedirects())
    try:
        with opener.open(request, timeout=30) as response:
            status = int(response.status)
            if status not in accepted_statuses:
                raise PublicationError(error_code)
            body = _read_bounded_response(
                response,
                maximum_bytes,
                error_code,
            )
            return HttpResponse(
                status=status,
                headers=tuple(response.headers.raw_items()),
                body=body,
            )
    except urllib.error.HTTPError as error:
        try:
            status = int(error.code)
            if status in accepted_statuses:
                return HttpResponse(
                    status=status,
                    headers=tuple(error.headers.raw_items()),
                    body=b"",
                )
        finally:
            error.close()
        raise PublicationError(error_code) from None
    except (
        OSError,
        TimeoutError,
        urllib.error.URLError,
    ) as error:
        raise PublicationError(error_code) from error


def _validated_endpoint(
    value: str,
    official_value: str,
    allow_loopback: bool,
) -> str:
    normalized = value.rstrip("/")
    if normalized == official_value:
        return normalized
    parsed = urllib.parse.urlsplit(normalized)
    if (
        not allow_loopback
        or parsed.scheme not in ("http", "https")
        or parsed.hostname not in ("127.0.0.1", "::1", "localhost")
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise PublicationError("endpoint-override")
    return normalized


def _required_github_token() -> str:
    token = os.environ.get("GITHUB_TOKEN")
    if (
        token is None
        or TOKEN_PATTERN.fullmatch(token) is None
    ):
        raise PublicationError("github-token-missing")
    return token


def _required_github_actor() -> str:
    actor = os.environ.get("GITHUB_ACTOR")
    if (
        actor is None
        or ACTOR_PATTERN.fullmatch(actor) is None
    ):
        raise PublicationError("github-actor-invalid")
    return actor


def _package_metadata(
    github_api_base_url: str,
) -> Mapping[str, Any]:
    response = _http_get(
        (
            github_api_base_url
            + "/users/moodworks/packages/container/fabrica-sam-worker"
        ),
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": "Bearer " + _required_github_token(),
            "User-Agent": "fabrica-sam-ghcr-publication-gate",
            "X-GitHub-Api-Version": GITHUB_API_VERSION,
        },
        maximum_bytes=MAX_PACKAGE_METADATA_BYTES,
        accepted_statuses={200},
        error_code="package-metadata-http",
    )
    return _strict_json_object(
        response.body,
        maximum_bytes=MAX_PACKAGE_METADATA_BYTES,
        error_code="package-metadata-envelope",
    )


def _owner_identity(github_api_base_url: str) -> int:
    response = _http_get(
        github_api_base_url + "/users/moodworks",
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": "Bearer " + _required_github_token(),
            "User-Agent": "fabrica-sam-ghcr-publication-gate",
            "X-GitHub-Api-Version": GITHUB_API_VERSION,
        },
        maximum_bytes=MAX_PACKAGE_METADATA_BYTES,
        accepted_statuses={200},
        error_code="owner-metadata-http",
    )
    metadata = _strict_json_object(
        response.body,
        maximum_bytes=MAX_PACKAGE_METADATA_BYTES,
        error_code="owner-metadata-envelope",
    )
    owner_id = metadata.get("id")
    if (
        metadata.get("login") != EXPECTED_OWNER
        or metadata.get("type") != "User"
        or isinstance(owner_id, bool)
        or not isinstance(owner_id, int)
        or owner_id < 1
    ):
        raise PublicationError("owner-user-identity")
    return owner_id


def _validate_public_package(
    metadata: Mapping[str, Any],
    expected_owner_id: int,
) -> None:
    owner = metadata.get("owner")
    repository = metadata.get("repository")
    package_id = metadata.get("id")
    owner_id = (
        owner.get("id")
        if isinstance(owner, dict)
        else None
    )
    repository_id = (
        repository.get("id")
        if isinstance(repository, dict)
        else None
    )
    repository_owner = (
        repository.get("owner")
        if isinstance(repository, dict)
        else None
    )
    if (
        isinstance(package_id, bool)
        or not isinstance(package_id, int)
        or package_id < 1
        or metadata.get("name") != EXPECTED_PACKAGE
        or metadata.get("package_type") != "container"
        or metadata.get("visibility") != "public"
        or not isinstance(owner, dict)
        or owner.get("login") != EXPECTED_OWNER
        or owner.get("type") != "User"
        or isinstance(owner_id, bool)
        or not isinstance(owner_id, int)
        or owner_id != expected_owner_id
        or not isinstance(repository, dict)
        or isinstance(repository_id, bool)
        or not isinstance(repository_id, int)
        or repository_id < 1
        or repository.get("name") != EXPECTED_REPOSITORY
        or repository.get("full_name")
        != EXPECTED_REPOSITORY_FULL_NAME
        or not isinstance(repository_owner, dict)
        or repository_owner.get("login") != EXPECTED_OWNER
        or repository_owner.get("type") != "User"
        or repository_owner.get("id") != owner_id
    ):
        raise PublicationError("package-public-linkage")


def _append_github_output(
    path: str | None,
    values: Mapping[str, str],
) -> None:
    if path is None:
        return
    with Path(path).open(
        "a",
        encoding="utf-8",
        newline="\n",
    ) as output:
        for key, value in values.items():
            if (
                OUTPUT_KEY_PATTERN.fullmatch(key) is None
                or not value
                or "\n" in value
                or "\r" in value
            ):
                raise PublicationError("github-output")
            output.write("%s=%s\n" % (key, value))


def verify_public_package(github_api_base_url: str) -> None:
    owner_id = _owner_identity(github_api_base_url)
    metadata = _package_metadata(github_api_base_url)
    _validate_public_package(metadata, owner_id)


def _registry_token(
    registry_token_url: str,
) -> str:
    actor = _required_github_actor()
    github_token = _required_github_token()
    basic = base64.b64encode(
        ("%s:%s" % (actor, github_token)).encode("utf-8")
    ).decode("ascii")
    query = urllib.parse.urlencode(
        {
            "service": "ghcr.io",
            "scope": (
                "repository:moodworks/fabrica-sam-worker:pull"
            ),
        }
    )
    response = _http_get(
        registry_token_url + "?" + query,
        headers={
            "Accept": "application/json",
            "Authorization": "Basic " + basic,
            "User-Agent": "fabrica-sam-ghcr-publication-verifier",
        },
        maximum_bytes=MAX_TOKEN_ENVELOPE_BYTES,
        accepted_statuses={200},
        error_code="registry-token-http",
    )
    return parse_registry_token(response.body)


def _authenticated_registry_get(
    registry_api_base_url: str,
    path: str,
    registry_token: str,
    *,
    accept: str | None,
    error_code: str,
) -> HttpResponse:
    headers = {
        "Authorization": "Bearer " + registry_token,
        "User-Agent": "fabrica-sam-ghcr-publication-verifier",
    }
    if accept is not None:
        headers["Accept"] = accept
    return _http_get(
        registry_api_base_url + path,
        headers=headers,
        maximum_bytes=MAX_REGISTRY_DOCUMENT_BYTES,
        accepted_statuses={200},
        error_code=error_code,
    )


def _anonymous_registry_get(
    registry_api_base_url: str,
    path: str,
    *,
    accept: str | None,
    accepted_statuses: set[int],
    error_code: str,
) -> HttpResponse:
    headers = {
        "User-Agent": "fabrica-sam-ghcr-publication-verifier",
    }
    if accept is not None:
        headers["Accept"] = accept
    return _http_get(
        registry_api_base_url + path,
        headers=headers,
        maximum_bytes=MAX_REGISTRY_DOCUMENT_BYTES,
        accepted_statuses=accepted_statuses,
        error_code=error_code,
    )


def _manifest_headers(response: HttpResponse) -> bytes:
    lines = ["HTTP/1.1 %d OK" % response.status]
    for name, value in response.headers:
        if name.lower() in (
            "content-type",
            "docker-content-digest",
        ):
            if (
                not name
                or "\r" in name
                or "\n" in name
                or "\r" in value
                or "\n" in value
            ):
                raise PublicationError("registry-manifest-headers")
            lines.append("%s: %s" % (name, value))
    try:
        return ("\r\n".join(lines) + "\r\n\r\n").encode(
            "ascii",
            errors="strict",
        )
    except UnicodeEncodeError as error:
        raise PublicationError("registry-manifest-headers") from error


def _build_root_digest(metadata_path: str) -> str:
    try:
        data = Path(metadata_path).read_bytes()
    except OSError as error:
        raise PublicationError("build-metadata") from error
    metadata = _strict_json_object(
        data,
        maximum_bytes=MAX_PACKAGE_METADATA_BYTES,
        error_code="build-metadata",
    )
    try:
        return validate_digest(
            metadata.get("containerimage.digest"),
            "build root",
        )
    except ImageManifestError as error:
        raise PublicationError("build-metadata") from error


def _verified_image_identity(
    *,
    build_metadata: str,
    source_commit: str,
    registry_api_base_url: str,
    registry_token_url: str,
) -> Mapping[str, str]:
    if (
        COMMIT_PATTERN.fullmatch(source_commit) is None
        or source_commit == "0" * 40
    ):
        raise PublicationError("source-commit")
    root_digest = _build_root_digest(build_metadata)
    registry_token = _registry_token(registry_token_url)
    manifest_accept = ", ".join(
        (
            "application/vnd.oci.image.manifest.v1+json",
            "application/vnd.docker.distribution.manifest.v2+json",
            "application/vnd.oci.image.index.v1+json",
            (
                "application/vnd.docker.distribution."
                "manifest.list.v2+json"
            ),
        )
    )
    root_response = _authenticated_registry_get(
        registry_api_base_url,
        (
            "/v2/moodworks/fabrica-sam-worker/manifests/"
            + root_digest
        ),
        registry_token,
        accept=manifest_accept,
        error_code="registry-root-http",
    )
    root = resolve_root(
        root_response.body,
        _manifest_headers(root_response),
        root_digest,
    )
    platform_manifest_digest = root["platformManifestDigest"]
    platform_manifest_size = int(root["platformManifestSize"], 10)
    if root["rootObjectType"] == "image-manifest":
        platform_response = root_response
    elif root["rootObjectType"] == "image-index":
        platform_response = _authenticated_registry_get(
            registry_api_base_url,
            (
                "/v2/moodworks/fabrica-sam-worker/manifests/"
                + platform_manifest_digest
            ),
            registry_token,
            accept=", ".join(sorted(IMAGE_MANIFEST_MEDIA_TYPES)),
            error_code="registry-platform-http",
        )
    else:
        raise PublicationError("registry-root-type")
    platform = inspect_platform_manifest(
        platform_response.body,
        _manifest_headers(platform_response),
        platform_manifest_digest,
        platform_manifest_size,
    )
    config_response = _authenticated_registry_get(
        registry_api_base_url,
        (
            "/v2/moodworks/fabrica-sam-worker/blobs/"
            + platform["configDigest"]
        ),
        registry_token,
        accept=None,
        error_code="registry-config-http",
    )
    verify_linux_amd64_config(
        config_response.body,
        platform["configDigest"],
        platform_manifest_digest,
        int(platform["configSize"], 10),
        source_commit,
        int(platform["layerCount"], 10),
    )
    verified_root, verified_manifest = (
        validate_root_platform_relationship(
            root_digest,
            root["rootObjectType"],
            platform_manifest_digest,
        )
    )
    return {
        "repository": EXPECTED_IMAGE_REPOSITORY,
        "sourceCommit": source_commit,
        "sourceTag": (
            "%s:%s" % (EXPECTED_IMAGE_REPOSITORY, source_commit)
        ),
        "imageReference": (
            "%s@%s"
            % (EXPECTED_IMAGE_REPOSITORY, verified_manifest)
        ),
        "platform": "linux/amd64",
        "platformManifestDigest": verified_manifest,
        "platformManifestMediaType": platform[
            "platformManifestMediaType"
        ],
        "platformManifestSize": str(platform_manifest_size),
        "configDigest": platform["configDigest"],
        "layerCount": platform["layerCount"],
        "buildRootDigest": verified_root,
        "buildRootObjectType": root["rootObjectType"],
        "buildKitProvenance": "disabled",
        "buildKitSbom": "disabled",
        "attestationClaim": (
            "environment-bound-not-hardware-backed"
        ),
    }


def _verify_anonymous_public_identity(
    registry_api_base_url: str,
    identity: Mapping[str, str],
) -> None:
    manifest_digest = identity["platformManifestDigest"]
    manifest_response = _anonymous_registry_get(
        registry_api_base_url,
        (
            "/v2/moodworks/fabrica-sam-worker/manifests/"
            + manifest_digest
        ),
        accept=", ".join(sorted(IMAGE_MANIFEST_MEDIA_TYPES)),
        accepted_statuses={200},
        error_code="anonymous-platform-http",
    )
    anonymous = inspect_platform_manifest(
        manifest_response.body,
        _manifest_headers(manifest_response),
        manifest_digest,
        int(identity["platformManifestSize"], 10),
    )
    if (
        anonymous["platformManifestMediaType"]
        != identity["platformManifestMediaType"]
        or anonymous["configDigest"] != identity["configDigest"]
        or anonymous["layerCount"] != identity["layerCount"]
    ):
        raise PublicationError("anonymous-platform-identity")

    latest_response = _anonymous_registry_get(
        registry_api_base_url,
        "/v2/moodworks/fabrica-sam-worker/manifests/latest",
        accept=", ".join(sorted(IMAGE_MANIFEST_MEDIA_TYPES)),
        accepted_statuses={404},
        error_code="anonymous-latest-http",
    )
    if latest_response.status != 404:
        raise PublicationError("anonymous-latest-present")


def _write_step_summary(
    path: str,
    identity: Mapping[str, str],
) -> None:
    summary = (
        "### Verified public SAM worker image identity\n\n"
        "- Package: `public`, user-owned by `moodworks`, linked to "
        "`moodworks/fabrica-kit`\n"
        "- Anonymous exact-manifest retrieval: verified\n"
        "- Anonymous `latest` lookup: verified HTTP 404\n"
        "- Source commit: `%s`\n"
        "- Platform: `linux/amd64`\n"
        "- Image: `%s`\n"
        "- Manifest media type: `%s`\n"
        "- Future worker configuration: "
        "`SAM_WORKER_IMAGE_DIGEST=%s`\n"
        "- BuildKit provenance: disabled\n"
        "- BuildKit SBOM: disabled\n"
        "- Proof scope: closed pre-build input graph plus post-push "
        "manifest/config/rootfs/history structure; no layer-tar byte claim\n"
        % (
            identity["sourceCommit"],
            identity["imageReference"],
            identity["platformManifestMediaType"],
            identity["platformManifestDigest"],
        )
    )
    try:
        with Path(path).open(
            "a",
            encoding="utf-8",
            newline="\n",
        ) as output:
            output.write(summary)
    except OSError as error:
        raise PublicationError("step-summary") from error


def verify_image(
    *,
    build_metadata: str,
    source_commit: str,
    registry_api_base_url: str,
    registry_token_url: str,
    github_api_base_url: str,
    github_output: str,
    step_summary: str,
) -> None:
    verify_public_package(github_api_base_url)
    identity = _verified_image_identity(
        build_metadata=build_metadata,
        source_commit=source_commit,
        registry_api_base_url=registry_api_base_url,
        registry_token_url=registry_token_url,
    )
    _verify_anonymous_public_identity(
        registry_api_base_url,
        identity,
    )
    _append_github_output(
        github_output,
        {
            "image_reference": identity["imageReference"],
            "platform_manifest_digest": identity[
                "platformManifestDigest"
            ],
            "platform_manifest_media_type": identity[
                "platformManifestMediaType"
            ],
            "source_commit": identity["sourceCommit"],
            "config_digest": identity["configDigest"],
            "build_root_digest": identity["buildRootDigest"],
            "build_root_object_type": identity[
                "buildRootObjectType"
            ],
            "package_visibility": "public",
            "package_owner": EXPECTED_OWNER,
            "package_repository": EXPECTED_REPOSITORY_FULL_NAME,
            "anonymous_manifest_proof": "exact-digest-http-200",
            "anonymous_latest_proof": "http-404",
        },
    )
    _write_step_summary(step_summary, identity)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--github-api-base-url",
        default=GITHUB_API_BASE_URL,
    )
    parser.add_argument(
        "--registry-api-base-url",
        default=REGISTRY_API_BASE_URL,
    )
    parser.add_argument(
        "--registry-token-url",
        default=REGISTRY_TOKEN_URL,
    )
    parser.add_argument(
        "--allow-loopback-test-endpoints",
        action="store_true",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    image = commands.add_parser("verify-image")
    image.add_argument("--build-metadata", required=True)
    image.add_argument("--source-commit", required=True)
    image.add_argument("--github-output", required=True)
    image.add_argument("--step-summary", required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    github_api_base_url = _validated_endpoint(
        arguments.github_api_base_url,
        GITHUB_API_BASE_URL,
        arguments.allow_loopback_test_endpoints,
    )
    registry_api_base_url = _validated_endpoint(
        arguments.registry_api_base_url,
        REGISTRY_API_BASE_URL,
        arguments.allow_loopback_test_endpoints,
    )
    registry_token_url = _validated_endpoint(
        arguments.registry_token_url,
        REGISTRY_TOKEN_URL,
        arguments.allow_loopback_test_endpoints,
    )
    verify_image(
        build_metadata=arguments.build_metadata,
        source_commit=arguments.source_commit,
        registry_api_base_url=registry_api_base_url,
        registry_token_url=registry_token_url,
        github_api_base_url=github_api_base_url,
        github_output=arguments.github_output,
        step_summary=arguments.step_summary,
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except PublicationError as error:
        raise SystemExit(
            "sam-worker-ghcr-publication-invalid:%s" % error.code
        ) from None
    except ImageManifestError:
        raise SystemExit(
            "sam-worker-ghcr-publication-invalid:image-identity"
        ) from None
    except Exception:
        raise SystemExit(
            "sam-worker-ghcr-publication-invalid:unexpected-local-failure"
        ) from None
