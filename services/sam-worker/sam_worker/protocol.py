"""Strict provider-independent SAM mask protocol and deterministic post-processing."""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import math
import re
import struct
import time
import zlib
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

CONTRACT_VERSION = "sam-mask-v2"
MASK_ENCODING = "fabrica-binary-rle-v1"
MAX_SOURCE_BYTES = 12_000_000
MAX_BASE64_CHARS = 16_000_000
MAX_REQUEST_JSON_BYTES = 16_100_000
MAX_SIDE = 4_096
MAX_PIXELS = 16_777_216
MAX_RGBA_BYTES = 67_108_864
MAX_POINTS = 32
MAX_RAW_CANDIDATES = 512
MAX_RAW_MASK_WORKING_BYTES = 268_435_456
MAX_CANDIDATES = 64
MAX_RLE_BYTES = 1_000_000
MAX_TOTAL_RLE_BYTES = 8_000_000
MAX_RESPONSE_BYTES = 12_000_000
PROMPT_AUTHORITIES = {"server-validated-detector", "user-interaction"}
REVIEW_FLAG_ORDER = ("near-contained", "overlapping", "touches-source-edge")
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MASK_DOMAIN = b"sam-mask-content-v1\x00"
CANDIDATE_DOMAIN = b"sam-mask-candidate-id-v1\x00"
LIVE_IDENTITY = {
    "kind": "meta-sam2.1",
    "repositoryUrl": "https://github.com/facebookresearch/sam2",
    "repositoryCommit": "05d9e57fb3945b10c861046c1e6749e2bfc258e3",
    "modelId": "sam2.1_hiera_base_plus",
    "configIdentity": "configs/sam2.1/sam2.1_hiera_b+.yaml",
    "checkpointUrl": "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt",
}
WORKER_IMAGE_DIGEST_PATTERN = re.compile(r"sha256:[0-9a-f]{64}")
ZERO_WORKER_IMAGE_DIGEST = "sha256:" + "0" * 64


class ContractError(ValueError):
    """A sanitized, non-retryable request or engine-boundary failure."""


def _closed(value: Any, required: Iterable[str], path: str) -> Mapping[str, Any]:
    if not isinstance(value, dict) or set(value) != set(required):
        raise ContractError("%s must be a strict closed object" % path)
    return value


def _integer(value: Any, minimum: int, maximum: int, path: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum or value > maximum:
        raise ContractError("%s must be a bounded integer" % path)
    return value


def _sha256(value: Any, path: str) -> str:
    if (
        not isinstance(value, str)
        or len(value) != 64
        or any(character not in "0123456789abcdef" for character in value)
    ):
        raise ContractError("%s must be a lowercase SHA-256" % path)
    return value


def worker_image_digest(value: Any, path: str = "worker image digest") -> str:
    """Validate an independently supplied OCI platform image-manifest digest."""

    if (
        not isinstance(value, str)
        or WORKER_IMAGE_DIGEST_PATTERN.fullmatch(value) is None
        or value == ZERO_WORKER_IMAGE_DIGEST
    ):
        raise ContractError(
            "%s must be a resolved lowercase sha256 OCI image-manifest digest"
            % path
        )
    return value


def _uuid(value: Any, path: str) -> str:
    if (
        not isinstance(value, str)
        or re.fullmatch(
            r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
            value,
        )
        is None
    ):
        raise ContractError("%s must be a canonical lowercase UUID" % path)
    return value


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True, allow_nan=False)


def canonical_base64_decode(value: Any, maximum_bytes: int, path: str) -> bytes:
    if (
        not isinstance(value, str)
        or not value
        or len(value) % 4
        or len(value) > MAX_BASE64_CHARS
        or any(character.isspace() or character in "-_" for character in value)
    ):
        raise ContractError("%s must be canonical padded RFC 4648 Base64" % path)
    try:
        decoded = base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error) as error:
        raise ContractError("%s is invalid Base64" % path) from error
    if len(decoded) > maximum_bytes or base64.b64encode(decoded).decode("ascii") != value:
        raise ContractError("%s is non-canonical or exceeds its byte limit" % path)
    return decoded


def _paeth(left: int, above: int, upper_left: int) -> int:
    estimate = left + above - upper_left
    left_distance = abs(estimate - left)
    above_distance = abs(estimate - above)
    diagonal_distance = abs(estimate - upper_left)
    if left_distance <= above_distance and left_distance <= diagonal_distance:
        return left
    if above_distance <= diagonal_distance:
        return above
    return upper_left


def decode_strict_rgba_png(encoded: bytes, declared_width: int, declared_height: int) -> bytes:
    if len(encoded) < 57 or encoded[:8] != PNG_SIGNATURE:
        raise ContractError("source PNG signature is invalid")
    cursor = 8
    chunks: List[Tuple[bytes, bytes]] = []
    saw_iend = False
    while cursor < len(encoded):
        if saw_iend or cursor + 12 > len(encoded):
            raise ContractError("source PNG framing or trailing data is invalid")
        length = struct.unpack(">I", encoded[cursor : cursor + 4])[0]
        chunk_type = encoded[cursor + 4 : cursor + 8]
        end = cursor + 12 + length
        if end > len(encoded) or len(chunk_type) != 4:
            raise ContractError("source PNG chunk exceeds its bounded input")
        data = encoded[cursor + 8 : cursor + 8 + length]
        expected_crc = struct.unpack(">I", encoded[cursor + 8 + length : end])[0]
        if (binascii.crc32(chunk_type + data) & 0xFFFFFFFF) != expected_crc:
            raise ContractError("source PNG chunk CRC is invalid")
        if chunk_type not in (b"IHDR", b"IDAT", b"IEND"):
            raise ContractError("source PNG contains a non-normalized or unknown chunk")
        chunks.append((chunk_type, data))
        cursor = end
        saw_iend = chunk_type == b"IEND"
    if not saw_iend or cursor != len(encoded):
        raise ContractError("source PNG must end at IEND")
    if chunks[0][0] != b"IHDR" or len(chunks[0][1]) != 13 or chunks[-1] != (b"IEND", b""):
        raise ContractError("source PNG requires one leading IHDR and final IEND")
    ihdr = chunks[0][1]
    width, height, bit_depth, color_type, compression, filtering, interlace = struct.unpack(
        ">IIBBBBB", ihdr
    )
    if (
        width != declared_width
        or height != declared_height
        or bit_depth != 8
        or color_type != 6
        or compression != 0
        or filtering != 0
        or interlace != 0
    ):
        raise ContractError("source PNG dimensions or strict RGBA profile drifted")
    idat_indexes = [index for index, chunk in enumerate(chunks) if chunk[0] == b"IDAT"]
    if (
        not idat_indexes
        or idat_indexes != list(range(idat_indexes[0], idat_indexes[-1] + 1))
        or idat_indexes[0] != 1
        or idat_indexes[-1] != len(chunks) - 2
    ):
        raise ContractError("source PNG IDAT chunks must be present and contiguous")
    compressed = b"".join(chunks[index][1] for index in idat_indexes)
    expected_size = height * (1 + width * 4)
    decompressor = zlib.decompressobj()
    try:
        scanlines = decompressor.decompress(compressed, expected_size + 1)
        if decompressor.unconsumed_tail or len(scanlines) > expected_size:
            raise ContractError("source PNG expands beyond its decoded allocation")
        scanlines += decompressor.flush(expected_size + 1 - len(scanlines))
    except zlib.error as error:
        raise ContractError("source PNG compressed payload is invalid") from error
    if (
        len(scanlines) != expected_size
        or not decompressor.eof
        or decompressor.unused_data
        or decompressor.unconsumed_tail
    ):
        raise ContractError("source PNG decoded size is short, excessive, or trailing")
    stride = width * 4
    rgba = bytearray(width * height * 4)
    previous = bytearray(stride)
    scan_cursor = 0
    output_cursor = 0
    for _row in range(height):
        filter_type = scanlines[scan_cursor]
        scan_cursor += 1
        if filter_type > 4:
            raise ContractError("source PNG uses an invalid row filter")
        current = bytearray(scanlines[scan_cursor : scan_cursor + stride])
        scan_cursor += stride
        for index in range(stride):
            left = current[index - 4] if index >= 4 else 0
            above = previous[index]
            upper_left = previous[index - 4] if index >= 4 else 0
            if filter_type == 1:
                current[index] = (current[index] + left) & 0xFF
            elif filter_type == 2:
                current[index] = (current[index] + above) & 0xFF
            elif filter_type == 3:
                current[index] = (current[index] + ((left + above) // 2)) & 0xFF
            elif filter_type == 4:
                current[index] = (current[index] + _paeth(left, above, upper_left)) & 0xFF
        rgba[output_cursor : output_cursor + stride] = current
        output_cursor += stride
        previous = current
    return bytes(rgba)


def basis_point_to_pixel(value: int, dimension: int) -> int:
    return min(dimension - 1, (value * dimension) // 10_000)


def box_basis_to_pixels(box: Mapping[str, int], width: int, height: int) -> Dict[str, int]:
    left = (box["xBps"] * width) // 10_000
    top = (box["yBps"] * height) // 10_000
    right_exclusive = min(
        width, max(left + 1, math.ceil((box["xBps"] + box["widthBps"]) * width / 10_000))
    )
    bottom_exclusive = min(
        height, max(top + 1, math.ceil((box["yBps"] + box["heightBps"]) * height / 10_000))
    )
    return {
        "left": left,
        "top": top,
        "rightInclusive": right_exclusive - 1,
        "bottomInclusive": bottom_exclusive - 1,
    }


@dataclass(frozen=True)
class ValidatedRequest:
    request: Mapping[str, Any]
    source_bytes: bytes
    rgba_bytes: bytes


def parse_request(value: Any) -> ValidatedRequest:
    request = _closed(
        value,
        (
            "contractVersion",
            "requestId",
            "workspaceId",
            "jobId",
            "attemptId",
            "workerImageDigest",
            "source",
            "segmentation",
            "limits",
            "output",
        ),
        "request",
    )
    if request["contractVersion"] != CONTRACT_VERSION:
        raise ContractError("request contract version is unsupported")
    for key in ("requestId", "workspaceId", "jobId", "attemptId"):
        _uuid(request[key], "request." + key)
    worker_image_digest(
        request["workerImageDigest"], "request.workerImageDigest"
    )
    try:
        request_json_size = len(canonical_json(request).encode("utf-8"))
    except (TypeError, ValueError) as error:
        raise ContractError("request must contain only finite canonical JSON values") from error
    if request_json_size > MAX_REQUEST_JSON_BYTES:
        raise ContractError("request JSON exceeds its byte budget")
    source = _closed(
        request["source"], ("mediaType", "byteSize", "width", "height", "sha256", "pngBase64"), "source"
    )
    if source["mediaType"] != "image/png":
        raise ContractError("SAM source accepts only image/png")
    width = _integer(source["width"], 1, MAX_SIDE, "source.width")
    height = _integer(source["height"], 1, MAX_SIDE, "source.height")
    if width * height > MAX_PIXELS or width * height * 4 > MAX_RGBA_BYTES:
        raise ContractError("source decoded allocation exceeds limits")
    byte_size = _integer(source["byteSize"], 1, MAX_SOURCE_BYTES, "source.byteSize")
    source_sha = _sha256(source["sha256"], "source.sha256")
    source_bytes = canonical_base64_decode(source["pngBase64"], MAX_SOURCE_BYTES, "source.pngBase64")
    if len(source_bytes) != byte_size or hashlib.sha256(source_bytes).hexdigest() != source_sha:
        raise ContractError("source byte length or SHA-256 differs")
    rgba = decode_strict_rgba_png(source_bytes, width, height)

    segmentation = request["segmentation"]
    if not isinstance(segmentation, dict) or "mode" not in segmentation:
        raise ContractError("segmentation must be a strict mode union")
    mode = segmentation["mode"]
    if mode == "automatic-candidates":
        _closed(segmentation, ("mode", "prompt"), "segmentation")
        prompt = _closed(segmentation["prompt"], ("kind",), "segmentation.prompt")
        if prompt["kind"] != "none":
            raise ContractError("automatic mode accepts only the none prompt")
    elif mode == "point-prompt":
        _closed(segmentation, ("mode", "prompt"), "segmentation")
        prompt = _closed(
            segmentation["prompt"], ("kind", "authority", "points"), "segmentation.prompt"
        )
        if prompt["kind"] != "points" or prompt["authority"] not in PROMPT_AUTHORITIES:
            raise ContractError("point prompt authority or kind is forbidden")
        points = prompt["points"]
        if not isinstance(points, list) or not 1 <= len(points) <= MAX_POINTS:
            raise ContractError("point prompt count is invalid")
        positive = False
        for index, point_value in enumerate(points):
            point = _closed(
                point_value, ("xBps", "yBps", "polarity"), "segmentation.prompt.points[%d]" % index
            )
            _integer(point["xBps"], 0, 10_000, "point.xBps")
            _integer(point["yBps"], 0, 10_000, "point.yBps")
            if point["polarity"] not in ("positive", "negative"):
                raise ContractError("point polarity is invalid")
            positive = positive or point["polarity"] == "positive"
        if not positive:
            raise ContractError("point prompt requires a positive point")
    elif mode == "box-prompt":
        _closed(segmentation, ("mode", "prompt"), "segmentation")
        prompt = _closed(segmentation["prompt"], ("kind", "authority", "box"), "segmentation.prompt")
        if prompt["kind"] != "box" or prompt["authority"] not in PROMPT_AUTHORITIES:
            raise ContractError("box prompt authority or kind is forbidden")
        box = _closed(prompt["box"], ("xBps", "yBps", "widthBps", "heightBps"), "box")
        x = _integer(box["xBps"], 0, 10_000, "box.xBps")
        y = _integer(box["yBps"], 0, 10_000, "box.yBps")
        box_width = _integer(box["widthBps"], 1, 10_000, "box.widthBps")
        box_height = _integer(box["heightBps"], 1, 10_000, "box.heightBps")
        if x + box_width > 10_000 or y + box_height > 10_000:
            raise ContractError("box prompt exceeds source basis")
    else:
        raise ContractError("segmentation mode is unsupported")

    limits = _closed(request["limits"], ("minMaskAreaPixels", "maxCandidates"), "limits")
    minimum_area = _integer(limits["minMaskAreaPixels"], 1, MAX_PIXELS, "limits.minMaskAreaPixels")
    if minimum_area > width * height:
        raise ContractError("minimum mask area exceeds source area")
    _integer(limits["maxCandidates"], 1, MAX_CANDIDATES, "limits.maxCandidates")
    output = _closed(request["output"], ("maskEncoding",), "output")
    if output["maskEncoding"] != MASK_ENCODING:
        raise ContractError("mask encoding is unsupported")
    return ValidatedRequest(request=request, source_bytes=source_bytes, rgba_bytes=rgba)


def _uleb128(value: int) -> bytes:
    output = bytearray()
    while True:
        byte = value & 0x7F
        value //= 128
        if value:
            byte |= 0x80
        output.append(byte)
        if not value:
            return bytes(output)


def encode_rle(
    mask: bytes, width: int, height: int, maximum_bytes: Optional[int] = None
) -> bytes:
    if len(mask) != width * height or not mask or any(value not in (0, 1) for value in mask):
        raise ContractError("mask dimensions or binary values are invalid")
    output = bytearray(b"FBRL\x01" + struct.pack(">II", width, height) + bytes((mask[0],)) + b"\x00\x00\x00\x00")
    run_count = 0
    current = mask[0]
    count = 1
    for value in mask[1:]:
        if value == current:
            count += 1
        else:
            output.extend(_uleb128(count))
            run_count += 1
            if maximum_bytes is not None and len(output) > maximum_bytes:
                return bytes(maximum_bytes + 1)
            current = value
            count = 1
    output.extend(_uleb128(count))
    run_count += 1
    if maximum_bytes is not None and len(output) > maximum_bytes:
        return bytes(maximum_bytes + 1)
    output[14:18] = struct.pack(">I", run_count)
    return bytes(output)


def decode_rle(encoded: bytes, expected_width: Optional[int] = None, expected_height: Optional[int] = None) -> Tuple[int, int, bytes]:
    if len(encoded) < 19 or len(encoded) > MAX_RLE_BYTES or encoded[:5] != b"FBRL\x01":
        raise ContractError("binary RLE header is invalid")
    width, height = struct.unpack(">II", encoded[5:13])
    first_value = encoded[13]
    run_count = struct.unpack(">I", encoded[14:18])[0]
    pixels = width * height
    if (
        width < 1
        or height < 1
        or width > MAX_SIDE
        or height > MAX_SIDE
        or pixels > MAX_PIXELS
        or first_value not in (0, 1)
        or not 1 <= run_count <= pixels
        or (expected_width is not None and width != expected_width)
        or (expected_height is not None and height != expected_height)
    ):
        raise ContractError("binary RLE dimensions or counts are invalid")
    cursor = 18
    output = bytearray()
    value = first_value
    for _index in range(run_count):
        start = cursor
        run = 0
        multiplier = 1
        for _byte_index in range(4):
            if cursor >= len(encoded):
                raise ContractError("binary RLE run is truncated")
            byte = encoded[cursor]
            cursor += 1
            run += (byte & 0x7F) * multiplier
            if run > pixels:
                raise ContractError("binary RLE run overflows mask pixels")
            if not byte & 0x80:
                break
            multiplier *= 128
        else:
            raise ContractError("binary RLE run exceeds four bytes")
        if run < 1 or encoded[start:cursor] != _uleb128(run):
            raise ContractError("binary RLE run is zero or non-minimal")
        if len(output) + run > pixels:
            raise ContractError("binary RLE pixel sum is excessive")
        output.extend(bytes((value,)) * run)
        value = 1 - value
    if cursor != len(encoded) or len(output) != pixels:
        raise ContractError("binary RLE has trailing data or the wrong pixel sum")
    return width, height, bytes(output)


def pack_mask(mask: bytes) -> bytes:
    packed = bytearray(math.ceil(len(mask) / 8))
    for index, value in enumerate(mask):
        if value not in (0, 1):
            raise ContractError("mask bit is non-binary")
        if value:
            packed[index // 8] |= 1 << (7 - index % 8)
    return bytes(packed)


def mask_digest(mask: bytes, width: int, height: int) -> str:
    return hashlib.sha256(
        MASK_DOMAIN + struct.pack(">II", width, height) + pack_mask(mask)
    ).hexdigest()


def candidate_id(source_sha256: str, width: int, height: int, mask_sha256: str) -> str:
    material = (
        CANDIDATE_DOMAIN
        + bytes.fromhex(source_sha256)
        + struct.pack(">II", width, height)
        + bytes.fromhex(mask_sha256)
    )
    return "samc_v1_" + hashlib.sha256(material).hexdigest()


def _mask_bounds(mask: bytes, width: int, height: int) -> Tuple[int, int, int, int, int]:
    left = width
    top = height
    right = bottom = area = 0
    for index, value in enumerate(mask):
        if value not in (0, 1):
            raise ContractError("engine returned a non-binary mask")
        if not value:
            continue
        x = index % width
        y = index // width
        left = min(left, x)
        top = min(top, y)
        right = max(right, x + 1)
        bottom = max(bottom, y + 1)
        area += 1
    if area == 0:
        raise ContractError("engine returned an empty mask")
    return left, top, right, bottom, area


def _quantize_score(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ContractError("engine score is not numeric")
    score = float(value)
    if not math.isfinite(score) or score < 0 or score > 1:
        raise ContractError("engine score is outside zero through one")
    return math.floor(score * 10_000 + 0.5)


def _candidate_sort_key(candidate: Mapping[str, Any]) -> Tuple[Any, ...]:
    bounds = candidate["bounds"]
    return (
        -candidate["predictedIouBps"],
        -candidate["stabilityScoreBps"],
        -candidate["pixelArea"],
        bounds["yBps"],
        bounds["xBps"],
        bounds["widthBps"],
        bounds["heightBps"],
        candidate["mask"]["sha256"],
    )


def _pair_counts(
    left_packed: bytes, right_packed: bytes, left_area: int, right_area: int
) -> Tuple[int, int, int, int]:
    left_bits = int.from_bytes(left_packed, "big")
    right_bits = int.from_bytes(right_packed, "big")
    # bin(...).count is implemented in C and remains compatible with the local Python 3.9 test host.
    intersection = bin(left_bits & right_bits).count("1")
    union = bin(left_bits | right_bits).count("1")
    return intersection, union, left_area, right_area


def postprocess(
    request: Mapping[str, Any], raw_candidates: Sequence[Mapping[str, Any]]
) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    raw_count = len(raw_candidates)
    if raw_count > MAX_RAW_CANDIDATES:
        raise ContractError("ENGINE_OUTPUT_LIMIT: raw candidate count exceeds 512")
    width = request["source"]["width"]
    height = request["source"]["height"]
    source_sha = request["source"]["sha256"]
    pixel_count = width * height
    if raw_count * pixel_count > MAX_RAW_MASK_WORKING_BYTES:
        raise ContractError(
            "ENGINE_OUTPUT_LIMIT: aggregate raw mask working bytes exceed 256 MiB"
        )
    prepared: List[
        Tuple[bytes, bytes, Tuple[int, int, int, int, int], Dict[str, Any]]
    ] = []
    for raw in raw_candidates:
        _closed(raw, ("mask", "predictedIou", "stabilityScore"), "engine candidate")
        raw_mask = raw["mask"]
        if not isinstance(raw_mask, (bytes, bytearray)) or len(raw_mask) != pixel_count:
            raise ContractError("engine candidate mask dimensions drifted")
        mask = bytes(raw_mask)
        left, top, right, bottom, area = _mask_bounds(mask, width, height)
        packed = pack_mask(mask)
        mask_sha = hashlib.sha256(
            MASK_DOMAIN + struct.pack(">II", width, height) + packed
        ).hexdigest()
        left_bps = (left * 10_000) // width
        top_bps = (top * 10_000) // height
        right_bps = math.ceil(right * 10_000 / width)
        bottom_bps = math.ceil(bottom * 10_000 / height)
        candidate = {
            "candidateId": candidate_id(source_sha, width, height, mask_sha),
            "bounds": {
                "xBps": left_bps,
                "yBps": top_bps,
                "widthBps": right_bps - left_bps,
                "heightBps": bottom_bps - top_bps,
            },
            "pixelArea": area,
            "areaRatioBps": (area * 10_000) // pixel_count,
            "predictedIouBps": _quantize_score(raw["predictedIou"]),
            "stabilityScoreBps": _quantize_score(raw["stabilityScore"]),
            "mask": {
                "encoding": MASK_ENCODING,
                "width": width,
                "height": height,
                "byteSize": 1,
                "dataBase64": "",
                "sha256": mask_sha,
            },
            "reviewFlags": [],
        }
        prepared.append((mask, packed, (left, top, right, bottom, area), candidate))
    prepared.sort(key=lambda entry: _candidate_sort_key(entry[3]))
    counts = {
        "rawCandidateCount": raw_count,
        "exactDuplicateFiltered": 0,
        "tinyFiltered": 0,
        "fullCanvasFiltered": 0,
        "rleTooLargeFiltered": 0,
        "rleBudgetFiltered": 0,
        "candidateLimitFiltered": 0,
        "returnedCandidateCount": 0,
    }
    unique: List[
        Tuple[bytes, bytes, Tuple[int, int, int, int, int], Dict[str, Any]]
    ] = []
    seen = set()
    for entry in prepared:
        candidate = entry[3]
        if candidate["pixelArea"] < request["limits"]["minMaskAreaPixels"]:
            counts["tinyFiltered"] += 1
        elif candidate["pixelArea"] == pixel_count:
            counts["fullCanvasFiltered"] += 1
        elif candidate["mask"]["sha256"] in seen:
            counts["exactDuplicateFiltered"] += 1
        else:
            seen.add(candidate["mask"]["sha256"])
            unique.append(entry)
    selected: List[
        Tuple[bytes, Tuple[int, int, int, int, int], bytes, Dict[str, Any]]
    ] = []
    total_rle = 0
    for mask, packed, bounds, candidate in unique:
        encoded = encode_rle(mask, width, height, MAX_RLE_BYTES)
        size = len(encoded)
        if size > MAX_RLE_BYTES:
            counts["rleTooLargeFiltered"] += 1
        elif total_rle + size > MAX_TOTAL_RLE_BYTES:
            counts["rleBudgetFiltered"] += 1
        elif len(selected) >= request["limits"]["maxCandidates"]:
            counts["candidateLimitFiltered"] += 1
        else:
            candidate["mask"]["byteSize"] = size
            candidate["mask"]["dataBase64"] = base64.b64encode(encoded).decode("ascii")
            selected.append((packed, bounds, encoded, candidate))
            total_rle += size
    if isinstance(raw_candidates, list):
        raw_candidates.clear()
    prepared.clear()
    unique.clear()
    seen.clear()
    mask = b""
    packed = b""
    bounds = (0, 0, 0, 0, 0)
    encoded = b""
    candidate = {}
    flags = [set() for _entry in selected]
    for left_index, (left_packed, left_bounds, _encoded, left_candidate) in enumerate(
        selected
    ):
        if (
            left_bounds[0] == 0
            or left_bounds[1] == 0
            or left_bounds[2] == width
            or left_bounds[3] == height
        ):
            flags[left_index].add("touches-source-edge")
        for right_index in range(left_index + 1, len(selected)):
            right_bounds = selected[right_index][1]
            if (
                left_bounds[2] <= right_bounds[0]
                or right_bounds[2] <= left_bounds[0]
                or left_bounds[3] <= right_bounds[1]
                or right_bounds[3] <= left_bounds[1]
            ):
                continue
            intersection, union, left_area, right_area = _pair_counts(
                left_packed,
                selected[right_index][0],
                left_candidate["pixelArea"],
                selected[right_index][3]["pixelArea"],
            )
            containment = (intersection * 10_000) // min(left_area, right_area)
            overlap = (intersection * 10_000) // union
            if containment >= 9_800:
                flags[left_index].add("near-contained")
                flags[right_index].add("near-contained")
            if overlap >= 5_000:
                flags[left_index].add("overlapping")
                flags[right_index].add("overlapping")
    for index, (_packed, _bounds, _encoded, output_candidate) in enumerate(selected):
        output_candidate["reviewFlags"] = [
            flag for flag in REVIEW_FLAG_ORDER if flag in flags[index]
        ]
    returned = [entry[3] for entry in selected]
    counts["returnedCandidateCount"] = len(returned)
    return returned, counts


def build_response(
    validated: ValidatedRequest,
    engine: Any,
    trusted_worker_image_digest: str,
) -> Dict[str, Any]:
    trusted_digest = worker_image_digest(
        trusted_worker_image_digest, "trusted worker image digest"
    )
    if validated.request["workerImageDigest"] != trusted_digest:
        raise ContractError(
            "request worker image identity differs from trusted runtime configuration"
        )
    started = time.monotonic()
    inference_started = time.monotonic()
    raw_candidates = engine.segment(validated)
    inference_ms = max(0, math.floor((time.monotonic() - inference_started) * 1000))
    candidates, filter_summary = postprocess(validated.request, raw_candidates)
    total_ms = max(inference_ms, math.floor((time.monotonic() - started) * 1000))
    identity = engine.execution_identity()
    if not isinstance(identity, dict) or identity.get("kind") not in ("meta-sam2.1", "deterministic-fake"):
        raise ContractError("engine execution identity is invalid")
    if identity["kind"] == "deterministic-fake":
        _closed(identity, ("kind", "engineId", "definitionSha256", "notice"), "fake identity")
        _sha256(identity["definitionSha256"], "fake identity definition")
        if (
            not isinstance(identity["engineId"], str)
            or re.fullmatch(r"[a-z0-9][a-z0-9.-]{2,127}", identity["engineId"]) is None
            or identity["notice"] != "NOT_SAM_OUTPUT"
        ):
            raise ContractError("fake engine identity is not honestly labelled")
    else:
        identity = {
            **identity,
            "workerImageDigest": trusted_digest,
        }
        _closed(
            identity,
            (
                "kind",
                "repositoryUrl",
                "repositoryCommit",
                "modelId",
                "configIdentity",
                "checkpointUrl",
                "checkpointSha256",
                "workerImageDigest",
            ),
            "live identity",
        )
        checkpoint_sha = _sha256(identity["checkpointSha256"], "checkpoint digest")
        worker_image_digest(
            identity["workerImageDigest"], "live identity worker image digest"
        )
        if checkpoint_sha == "0" * 64 or any(
            identity[key] != value for key, value in LIVE_IDENTITY.items()
        ):
            raise ContractError("live engine identity differs from the pinned reviewed identity")
    unsigned: Dict[str, Any] = {
        "contractVersion": CONTRACT_VERSION,
        "requestId": validated.request["requestId"],
        "workspaceId": validated.request["workspaceId"],
        "jobId": validated.request["jobId"],
        "attemptId": validated.request["attemptId"],
        "sourceSha256": validated.request["source"]["sha256"],
        "executionIdentity": identity,
        "timing": {"inferenceMs": inference_ms, "totalMs": total_ms},
        "filterSummary": filter_summary,
        "candidateCount": len(candidates),
        "candidates": candidates,
    }
    response = dict(unsigned)
    response["responseSha256"] = hashlib.sha256(canonical_json(unsigned).encode("utf-8")).hexdigest()
    if len(canonical_json(response).encode("utf-8")) > MAX_RESPONSE_BYTES:
        raise ContractError("worker response exceeds its JSON byte budget")
    return response
