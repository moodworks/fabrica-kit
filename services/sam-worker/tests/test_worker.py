from __future__ import annotations

import asyncio
import base64
import binascii
import copy
import hashlib
import importlib.metadata
import json
import math
import os
import re
import runpy
import shlex
import struct
import sys
import tempfile
import threading
import time
import types
import unittest
import zlib
from array import array
from pathlib import Path
from typing import Any, Dict, Mapping, Sequence
from unittest.mock import patch

from sam_worker.artifacts import ArtifactError
from sam_worker.engine import (
    AUTOMATIC_BATCH_FIXED_RESERVE_BYTES,
    AUTOMATIC_BATCH_WORKING_BYTES,
    AUTOMATIC_COMPACT_RLE_RUN_BYTES,
    AUTOMATIC_ENCODER_BYTES_PER_MASK_PIXEL,
    AUTOMATIC_ENCODER_BYTES_PER_MASK_PIXEL_TOTAL,
    AUTOMATIC_RETAINED_COMPACT_RLE_BYTES,
    AUTOMATIC_RETAINED_METADATA_BYTES,
    MAX_AUTOMATIC_RETAINED_RLE_RUNS,
    AutomaticBatchBudget,
    ProductionSamEngine,
    automatic_batch_peak_bytes,
    automatic_points_per_batch,
    compact_official_automatic_batch,
    load_reviewed_checkpoint,
    materialize_compact_automatic_candidates,
    materialize_guarded_automatic_rles,
)
from sam_worker.protocol import (
    MAX_REQUEST_JSON_BYTES,
    MAX_RAW_MASK_WORKING_BYTES,
    ContractError,
    basis_point_to_pixel,
    box_basis_to_pixels,
    build_response,
    candidate_id,
    canonical_json,
    decode_rle,
    decode_strict_rgba_png,
    encode_rle,
    mask_digest,
    parse_request,
    postprocess,
)
from sam_worker.hosting import DIRECT_HOSTING_PROFILE, DIRECT_HOSTING_PROFILE_SHA256
from sam_worker.model_loader import (
    TARGET_INVENTORY,
    ModelConfigError,
    _verify_constructor_origins,
    build_reviewed_model,
    instantiate_reviewed_config,
    parse_reviewed_config,
)
from sam_worker.runtime import (
    MODEL_LOADED_READY,
    MODEL_NOT_STAGED,
    MODEL_STAGED_NOT_LOADED,
    STARTUP_BLOCKED,
    STARTUP_STATE_LOG_MESSAGES,
    SamWorkerRuntime,
    create_production_runtime,
)
from sam_worker.server import validated_port

try:
    import yaml

    YAML_TEST_DEPS_AVAILABLE = True
except ModuleNotFoundError:
    yaml = Any  # type: ignore[assignment]
    YAML_TEST_DEPS_AVAILABLE = False

ROOT = Path(__file__).resolve().parents[3]
VECTORS = json.loads((ROOT / "services/sam-worker/protocol-vectors.json").read_text("utf-8"))


def chunk(kind: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + kind
        + data
        + struct.pack(">I", binascii.crc32(kind + data) & 0xFFFFFFFF)
    )


def filtered_row(raw: bytes, filter_type: int, previous: bytes) -> bytes:
    encoded = bytearray(len(raw))
    for index, value in enumerate(raw):
        left = raw[index - 4] if index >= 4 else 0
        above = previous[index] if previous else 0
        upper_left = previous[index - 4] if previous and index >= 4 else 0
        estimate = left + above - upper_left
        distances = (abs(estimate - left), abs(estimate - above), abs(estimate - upper_left))
        paeth = left if distances[0] <= distances[1] and distances[0] <= distances[2] else (
            above if distances[1] <= distances[2] else upper_left
        )
        predictor = (0, left, above, (left + above) // 2, paeth)[filter_type]
        encoded[index] = (value - predictor) & 0xFF
    return bytes((filter_type,)) + bytes(encoded)


def rgba_png(width: int, height: int, filter_types: Sequence[int] = ()) -> tuple[bytes, bytes]:
    rgba = bytes(
        value
        for y in range(height)
        for x in range(width)
        for value in ((x * 17) & 255, (y * 31) & 255, ((x + y) * 13) & 255, 255)
    )
    rows = []
    previous = b""
    for y in range(height):
        row = rgba[y * width * 4 : (y + 1) * width * 4]
        filter_type = filter_types[y] if y < len(filter_types) else 0
        rows.append(filtered_row(row, filter_type, previous))
        previous = row
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(b"".join(rows), 9))
        + chunk(b"IEND", b""),
        rgba,
    )


def request(width: int = 10, height: int = 10) -> Dict[str, Any]:
    png, _rgba = rgba_png(width, height)
    return {
        "contractVersion": "sam-mask-v1",
        "requestId": "9d4c6db4-9808-4c21-9e6b-924edc266f41",
        "workspaceId": "32205d2c-f4a4-41bf-a08d-9927bb4b4b52",
        "jobId": "337ed90e-234e-4cf4-8d94-0919a9249f4e",
        "attemptId": "684173c2-7a85-4703-b99f-abee3f037e53",
        "source": {
            "mediaType": "image/png",
            "byteSize": len(png),
            "width": width,
            "height": height,
            "sha256": hashlib.sha256(png).hexdigest(),
            "pngBase64": base64.b64encode(png).decode("ascii"),
        },
        "segmentation": {"mode": "automatic-candidates", "prompt": {"kind": "none"}},
        "limits": {"minMaskAreaPixels": 2, "maxCandidates": 64},
        "output": {"maskEncoding": "fabrica-binary-rle-v1"},
    }


def rectangle(width: int, height: int, left: int, top: int, right: int, bottom: int) -> bytes:
    result = bytearray(width * height)
    for y in range(top, bottom):
        result[y * width + left : y * width + right] = b"\x01" * (right - left)
    return bytes(result)


class FakeEngine:
    def __init__(self, candidates: Sequence[Mapping[str, Any]]) -> None:
        self.candidates = candidates

    def segment(self, _validated: Any) -> Sequence[Mapping[str, Any]]:
        return self.candidates

    def execution_identity(self) -> Mapping[str, Any]:
        return {
            "kind": "deterministic-fake",
            "engineId": "python-unit-fake-v1",
            "definitionSha256": "7" * 64,
            "notice": "NOT_SAM_OUTPUT",
        }


def run_fake(request_value: Mapping[str, Any], engine: Any) -> Mapping[str, Any]:
    return build_response(parse_request(request_value), engine)


def compact_candidate(width: int, height: int) -> Dict[str, Any]:
    return {
        "segmentation": {"size": [height, width], "counts": [width * height]},
        "area": 0,
        "bbox": [0, 0, 0, 0],
        "predicted_iou": 0.5,
        "point_coords": [[0, 0]],
        "stability_score": 0.5,
        "crop_box": [0, 0, width, height],
    }


class ProtocolTests(unittest.TestCase):
    def test_shared_protocol_vectors(self) -> None:
        self.assertEqual(VECTORS["vectorVersion"], 2)
        self.assertEqual(VECTORS["directHosting"]["profile"], DIRECT_HOSTING_PROFILE)
        self.assertEqual(
            VECTORS["directHosting"]["sha256"], DIRECT_HOSTING_PROFILE_SHA256
        )
        self.assertEqual(
            hashlib.sha256(
                canonical_json(DIRECT_HOSTING_PROFILE).encode("utf-8")
            ).hexdigest(),
            DIRECT_HOSTING_PROFILE_SHA256,
        )
        self.assertEqual(
            DIRECT_HOSTING_PROFILE["health"]["states"][
                MODEL_STAGED_NOT_LOADED
            ],
            {
                "status": 204,
                "body": "empty",
                "inferenceReady": False,
            },
        )
        self.assertEqual(
            DIRECT_HOSTING_PROFILE_SHA256,
            "2e5d64b6741802f7963fa678d174fca92a367a32672764fae5831c3131702f3a",
        )
        self.assertEqual(
            MAX_RAW_MASK_WORKING_BYTES,
            VECTORS["limits"]["rawMaskWorkingBytes"],
        )
        vector = VECTORS["mask"]
        mask = bytes(int(bit) for bit in vector["rowMajorBits"])
        encoded = encode_rle(mask, vector["width"], vector["height"])
        self.assertEqual(encoded.hex(), vector["rleHex"])
        self.assertEqual(base64.b64encode(encoded).decode("ascii"), vector["rleBase64"])
        self.assertEqual(decode_rle(encoded), (4, 3, mask))
        digest = mask_digest(mask, 4, 3)
        self.assertEqual(digest, vector["maskSha256"])
        self.assertEqual(candidate_id(vector["sourceSha256"], 4, 3, digest), vector["candidateId"])
        self.assertEqual(
            basis_point_to_pixel(
                VECTORS["coordinates"]["basisPoints"], VECTORS["coordinates"]["dimension"]
            ),
            VECTORS["coordinates"]["pixel"],
        )
        box = VECTORS["coordinates"]["box"]
        self.assertEqual(
            box_basis_to_pixels(box["input"], box["sourceWidth"], box["sourceHeight"]),
            box["output"],
        )
        self.assertEqual(canonical_json(VECTORS["canonicalJson"]["input"]), VECTORS["canonicalJson"]["encoded"])
        self.assertEqual(
            hashlib.sha256(VECTORS["canonicalJson"]["encoded"].encode()).hexdigest(),
            VECTORS["canonicalJson"]["sha256"],
        )

    def test_lossless_rle_rejects_noncanonical_and_trailing_data(self) -> None:
        encoded = bytes.fromhex(VECTORS["mask"]["rleHex"])
        self.assertEqual(decode_rle(encoded)[2], bytes(int(bit) for bit in "011011000001"))
        with self.assertRaises(ContractError):
            decode_rle(encoded + b"\x00")
        malformed = bytearray(encoded)
        malformed[18:19] = b"\x81\x00"
        with self.assertRaises(ContractError):
            decode_rle(bytes(malformed))
        zero = bytearray(encoded)
        zero[18] = 0
        with self.assertRaises(ContractError):
            decode_rle(bytes(zero))

    def test_png_decoder_unfilters_every_filter_and_rejects_drift(self) -> None:
        png, rgba = rgba_png(2, 5, (0, 1, 2, 3, 4))
        self.assertEqual(decode_strict_rgba_png(png, 2, 5), rgba)
        with self.assertRaises(ContractError):
            decode_strict_rgba_png(png, 3, 5)
        unknown = png[:-12] + chunk(b"tEXt", b"forbidden") + png[-12:]
        with self.assertRaises(ContractError):
            decode_strict_rgba_png(unknown, 2, 5)
        invalid_crc = bytearray(png)
        invalid_crc[-1] ^= 1
        with self.assertRaises(ContractError):
            decode_strict_rgba_png(bytes(invalid_crc), 2, 5)

    def test_request_is_closed_and_verifies_media_bytes_dimensions_and_digest(self) -> None:
        valid = request()
        parsed = parse_request(valid)
        self.assertEqual(parsed.request["source"]["width"], 10)
        for mutation in (
            lambda item: item.update({"url": "https://example.invalid/image.png"}),
            lambda item: item["source"].update({"mediaType": "image/jpeg"}),
            lambda item: item["source"].update({"sha256": "0" * 64}),
            lambda item: item["source"].update({"width": 9}),
            lambda item: item["source"].update({"pngBase64": item["source"]["pngBase64"].rstrip("=")}),
            lambda item: item.update({"requestId": item["requestId"].upper()}),
        ):
            changed = copy.deepcopy(valid)
            mutation(changed)
            with self.assertRaises(ContractError):
                parse_request(changed)

    def test_prompt_modes_and_basis_conversion_exclude_qwen(self) -> None:
        valid = request()
        point = copy.deepcopy(valid)
        point["segmentation"] = {
            "mode": "point-prompt",
            "prompt": {
                "kind": "points",
                "authority": "user-interaction",
                "points": [{"xBps": 10000, "yBps": 0, "polarity": "positive"}],
            },
        }
        parse_request(point)
        self.assertEqual(basis_point_to_pixel(10000, 10), 9)
        foreign = copy.deepcopy(point)
        foreign["segmentation"]["prompt"]["authority"] = "qwen-proposal"
        with self.assertRaises(ContractError):
            parse_request(foreign)
        foreign = copy.deepcopy(point)
        foreign["segmentation"]["prompt"]["points"][0]["xBps"] = math.nan
        with self.assertRaises(ContractError):
            parse_request(foreign)
        box = copy.deepcopy(valid)
        box["segmentation"] = {
            "mode": "box-prompt",
            "prompt": {
                "kind": "box",
                "authority": "server-validated-detector",
                "box": {"xBps": 9000, "yBps": 0, "widthBps": 1001, "heightBps": 10000},
            },
        }
        with self.assertRaises(ContractError):
            parse_request(box)

    def test_fake_engine_postprocessing_is_bounded_ordered_and_honest(self) -> None:
        valid = request()
        large = rectangle(10, 10, 0, 0, 9, 9)
        contained = rectangle(10, 10, 0, 0, 9, 8)
        tiny = rectangle(10, 10, 5, 5, 6, 6)
        full = bytes((1,)) * 100
        candidates = [
            {"mask": large, "predictedIou": 0.9, "stabilityScore": 0.95},
            {"mask": large, "predictedIou": 0.8, "stabilityScore": 0.9},
            {"mask": contained, "predictedIou": 0.85, "stabilityScore": 0.96},
            {"mask": tiny, "predictedIou": 0.99, "stabilityScore": 0.99},
            {"mask": full, "predictedIou": 0.99, "stabilityScore": 0.99},
        ]
        response = run_fake(valid, FakeEngine(candidates))
        self.assertEqual(response["executionIdentity"]["kind"], "deterministic-fake")
        self.assertNotIn("modelId", response["executionIdentity"])
        self.assertEqual(response["filterSummary"]["exactDuplicateFiltered"], 1)
        self.assertEqual(response["filterSummary"]["tinyFiltered"], 1)
        self.assertEqual(response["filterSummary"]["fullCanvasFiltered"], 1)
        self.assertEqual(response["candidateCount"], 2)
        self.assertEqual(response["candidates"][0]["predictedIouBps"], 9000)
        self.assertIn("near-contained", response["candidates"][0]["reviewFlags"])
        unsigned = dict(response)
        actual_digest = unsigned.pop("responseSha256")
        self.assertEqual(hashlib.sha256(canonical_json(unsigned).encode()).hexdigest(), actual_digest)
        self.assertNotIn("torch", sys.modules)
        self.assertNotIn("sam2", sys.modules)
        self.assertNotIn("runpod", sys.modules)

    def test_engine_raw_candidate_limit_fails_entire_request(self) -> None:
        mask = rectangle(10, 10, 1, 1, 2, 2)
        raw = [{"mask": mask, "predictedIou": 0.5, "stabilityScore": 0.5}] * 513
        with self.assertRaisesRegex(ContractError, "ENGINE_OUTPUT_LIMIT"):
            run_fake(request(), FakeEngine(raw))

    def test_compact_automatic_budget_rejects_before_any_decode(self) -> None:
        decode_calls = []

        def decoder(_rle: Any) -> bytes:
            decode_calls.append(True)
            return b""

        too_many = [compact_candidate(1, 1)] * 513
        with self.assertRaisesRegex(ContractError, "ENGINE_OUTPUT_LIMIT"):
            materialize_compact_automatic_candidates(too_many, 1, 1, decoder)
        self.assertEqual(decode_calls, [])

        over_budget = [compact_candidate(4096, 4096)] * 17
        with self.assertRaisesRegex(ContractError, "aggregate raw mask"):
            materialize_compact_automatic_candidates(over_budget, 4096, 4096, decoder)
        self.assertEqual(decode_calls, [])
        self.assertEqual(MAX_RAW_MASK_WORKING_BYTES, 268_435_456)

    def test_compact_automatic_validates_all_records_before_decode(self) -> None:
        valid = compact_candidate(2, 2)
        invalid = compact_candidate(2, 2)
        invalid["predicted_iou"] = math.nan
        decode_calls = []
        with self.assertRaisesRegex(ContractError, "score"):
            materialize_compact_automatic_candidates(
                [valid, invalid],
                2,
                2,
                lambda _rle: decode_calls.append(True) or b"\x00" * 4,
            )
        self.assertEqual(decode_calls, [])
        output = materialize_compact_automatic_candidates(
            [valid], 2, 2, lambda _rle: b"\x00\x01\x01\x00"
        )
        self.assertEqual(output[0]["mask"], b"\x00\x01\x01\x00")

    def test_all_transition_batch_peak_is_source_dependent_and_conservative(self) -> None:
        fixture_pixels = 738 * 255
        alternating_mask = bytes(index % 2 for index in range(fixture_pixels))
        all_transition_runs = 1 + sum(
            alternating_mask[index] != alternating_mask[index - 1]
            for index in range(1, len(alternating_mask))
        )
        self.assertEqual(all_transition_runs, fixture_pixels)
        fixture_batch = automatic_points_per_batch(738, 255)
        self.assertEqual(fixture_batch, 3)
        self.assertEqual(
            AUTOMATIC_ENCODER_BYTES_PER_MASK_PIXEL,
            {
                "full_resolution_float_logits": 4,
                "input_and_flattened_boolean_mask": 1,
                "preflight_difference_boolean": 1,
                "official_difference_boolean": 1,
                "two_column_int64_change_indices": 16,
                "full_batch_change_selector": 1,
                "filtered_offset_cat_and_difference_int64": 32,
                "cuda_to_cpu_int64": 8,
                "retained_python_count_and_destination_pointer": 36,
                "temporary_tolist_pointer_overlap": 8,
                "compaction_array_overlap": 4,
            },
        )
        self.assertEqual(AUTOMATIC_ENCODER_BYTES_PER_MASK_PIXEL_TOTAL, 112)
        self.assertEqual(
            AUTOMATIC_RETAINED_COMPACT_RLE_BYTES,
            MAX_AUTOMATIC_RETAINED_RLE_RUNS * AUTOMATIC_COMPACT_RLE_RUN_BYTES,
        )
        self.assertEqual(AUTOMATIC_RETAINED_COMPACT_RLE_BYTES, 32_000_000)
        self.assertEqual(AUTOMATIC_RETAINED_METADATA_BYTES, 8_388_608)
        self.assertEqual(AUTOMATIC_BATCH_FIXED_RESERVE_BYTES, 40_388_608)
        accepted_peak = automatic_batch_peak_bytes(738, 255, fixture_batch)
        refused_next_peak = automatic_batch_peak_bytes(
            738, 255, fixture_batch + 1
        )
        self.assertEqual(accepted_peak, 232_443_424)
        self.assertLessEqual(accepted_peak, AUTOMATIC_BATCH_WORKING_BYTES)
        self.assertEqual(refused_next_peak, 296_461_696)
        self.assertGreater(refused_next_peak, AUTOMATIC_BATCH_WORKING_BYTES)
        self.assertEqual(
            automatic_batch_peak_bytes(738, 255, 0),
            AUTOMATIC_BATCH_FIXED_RESERVE_BYTES,
        )
        self.assertEqual(automatic_points_per_batch(10, 10), 64)
        with self.assertRaisesRegex(ContractError, "cannot fit one worst-case batch"):
            automatic_points_per_batch(4096, 4096)
        self.assertEqual(AUTOMATIC_BATCH_WORKING_BYTES, 268_435_456)

    def test_alternating_rle_refuses_before_official_list_materialization(self) -> None:
        alternating_mask = bytes(index % 2 for index in range(10))
        transition_count = sum(
            alternating_mask[index] != alternating_mask[index - 1]
            for index in range(1, len(alternating_mask))
        )
        self.assertEqual(transition_count, 9)
        budget = AutomaticBatchBudget(
            source_pixels=10,
            maximum_candidates=1,
            maximum_rle_runs=9,
        )
        materialize_calls = []
        with self.assertRaisesRegex(ContractError, "RLE run budget"):
            materialize_guarded_automatic_rles(
                budget,
                transition_counts=[transition_count],
                starts_with_one=[bool(alternating_mask[0])],
                materialize=lambda: materialize_calls.append(True),
            )
        self.assertEqual(materialize_calls, [])

        accepted = AutomaticBatchBudget(
            source_pixels=10,
            maximum_candidates=1,
            maximum_rle_runs=10,
        )
        result = materialize_guarded_automatic_rles(
            accepted,
            transition_counts=[transition_count],
            starts_with_one=[bool(alternating_mask[0])],
            materialize=lambda: "official-materialized",
        )
        self.assertEqual(result, "official-materialized")
        self.assertEqual(accepted.retained_rle_runs, 10)

    def test_official_fake_batch_is_compacted_disposed_and_retention_bounded(self) -> None:
        class FakeBatchData:
            def __init__(self, fields: Mapping[str, Any]) -> None:
                self.fields = dict(fields)

            def items(self) -> Any:
                return self.fields.items()

            def __getitem__(self, key: str) -> Any:
                return self.fields[key]

            def __delitem__(self, key: str) -> None:
                del self.fields[key]

        budget = AutomaticBatchBudget(
            source_pixels=10,
            maximum_candidates=1,
            maximum_rle_runs=MAX_AUTOMATIC_RETAINED_RLE_RUNS,
        )
        materialize_guarded_automatic_rles(
            budget,
            transition_counts=[9],
            starts_with_one=[False],
            materialize=lambda: None,
        )
        low_res_marker = object()
        batch = FakeBatchData(
            {
                "rles": [{"size": [1, 10], "counts": [1] * 10}],
                "boxes": [[0, 0, 9, 0]],
                "iou_preds": [0.9],
                "points": [[0, 0]],
                "low_res_masks": [low_res_marker],
                "stability_score": [0.95],
            }
        )
        compact_official_automatic_batch(batch, 10, 1, budget)
        self.assertIsInstance(batch["rles"][0]["counts"], array)
        self.assertEqual(batch["rles"][0]["counts"].itemsize, 4)
        self.assertNotIn("low_res_masks", batch.fields)

        materialize_guarded_automatic_rles(
            budget,
            transition_counts=[0],
            starts_with_one=[False],
            materialize=lambda: None,
        )
        second = FakeBatchData(
            {
                "rles": [{"size": [1, 10], "counts": [10]}],
                "boxes": [[0, 0, 0, 0]],
                "iou_preds": [0.9],
                "points": [[0, 0]],
                "low_res_masks": [object()],
                "stability_score": [0.95],
            }
        )
        with self.assertRaisesRegex(ContractError, "raw candidate count"):
            compact_official_automatic_batch(second, 10, 1, budget)

    def test_postprocess_enforces_return_rle_budgets_and_stable_score_ties(self) -> None:
        synthetic = {
            "source": {"width": 10, "height": 10, "sha256": "1" * 64},
            "limits": {"minMaskAreaPixels": 1, "maxCandidates": 1},
        }
        top_left = rectangle(10, 10, 0, 0, 2, 2)
        bottom_right = rectangle(10, 10, 8, 8, 10, 10)
        returned, summary = postprocess(
            synthetic,
            [
                {"mask": bottom_right, "predictedIou": 0.5, "stabilityScore": 0.5},
                {"mask": top_left, "predictedIou": 0.5, "stabilityScore": 0.5},
            ],
        )
        self.assertEqual(len(returned), 1)
        self.assertEqual(returned[0]["bounds"]["xBps"], 0)
        self.assertEqual(summary["candidateLimitFiltered"], 1)

        width = 1_000
        height = 900
        pixel_count = width * height
        masks = []
        base = bytearray(index % 2 for index in range(pixel_count))
        for index in range(10):
            candidate_mask = bytearray(base)
            candidate_mask[100 + index * 2] = 1
            masks.append(
                {
                    "mask": bytes(candidate_mask),
                    "predictedIou": 0.5,
                    "stabilityScore": 0.5,
                }
            )
        budget_request = {
            "source": {"width": width, "height": height, "sha256": "2" * 64},
            "limits": {"minMaskAreaPixels": 1, "maxCandidates": 64},
        }
        budget_returned, budget_summary = postprocess(budget_request, masks)
        self.assertLessEqual(
            sum(candidate["mask"]["byteSize"] for candidate in budget_returned),
            8_000_000,
        )
        self.assertGreaterEqual(budget_summary["rleBudgetFiltered"], 1)

        too_large_mask = bytes(index % 2 for index in range(1_100_000))
        too_large_request = {
            "source": {"width": 1_100, "height": 1_000, "sha256": "3" * 64},
            "limits": {"minMaskAreaPixels": 1, "maxCandidates": 64},
        }
        _none, too_large_summary = postprocess(
            too_large_request,
            [{"mask": too_large_mask, "predictedIou": 0.5, "stabilityScore": 0.5}],
        )
        self.assertEqual(too_large_summary["rleTooLargeFiltered"], 1)

    def test_invalid_engine_masks_scores_and_identity_fail_closed(self) -> None:
        valid_request = request()
        invalid_mask = bytearray(rectangle(10, 10, 1, 1, 2, 2))
        invalid_mask[0] = 2
        for candidate in (
            {"mask": bytes(invalid_mask), "predictedIou": 0.5, "stabilityScore": 0.5},
            {
                "mask": rectangle(10, 10, 1, 1, 2, 2),
                "predictedIou": math.inf,
                "stabilityScore": 0.5,
            },
        ):
            with self.assertRaises(ContractError):
                run_fake(valid_request, FakeEngine([candidate]))

        class InvalidIdentityEngine(FakeEngine):
            def execution_identity(self) -> Mapping[str, Any]:
                return {
                    "kind": "deterministic-fake",
                    "engineId": "INVALID",
                    "definitionSha256": "7" * 64,
                    "notice": "NOT_SAM_OUTPUT",
                }

        with self.assertRaisesRegex(ContractError, "honestly labelled"):
            run_fake(
                valid_request,
                InvalidIdentityEngine(
                    [
                        {
                            "mask": rectangle(10, 10, 1, 1, 2, 2),
                            "predictedIou": 0.5,
                            "stabilityScore": 0.5,
                        }
                    ]
                ),
            )

    def test_production_cleanup_resets_the_single_shared_predictor(self) -> None:
        class FakePredictor:
            resets = 0

            def reset_predictor(self) -> None:
                self.resets += 1

        class FakeCuda:
            clears = 0

            def empty_cache(self) -> None:
                self.clears += 1

        class FakeTorch:
            cuda = FakeCuda()

        engine = ProductionSamEngine()
        engine._predictor = FakePredictor()
        engine._device = "cuda"
        engine._torch = FakeTorch()
        engine._cleanup_request_state()
        self.assertEqual(engine._predictor.resets, 1)
        self.assertEqual(engine._torch.cuda.clears, 1)

        class RaisingPredictor:
            def reset_predictor(self) -> None:
                raise RuntimeError("deterministic cleanup failure")

        engine._predictor = RaisingPredictor()
        with self.assertRaisesRegex(RuntimeError, "cleanup failure"):
            engine._cleanup_request_state()
        self.assertEqual(engine._torch.cuda.clears, 2)

    def test_reviewed_checkpoint_load_is_weights_only_and_exact(self) -> None:
        class LoadResult:
            missing_keys: list[str] = []
            unexpected_keys: list[str] = []

        class FakeModel:
            def __init__(self) -> None:
                self.calls: list[tuple[Any, bool]] = []

            def load_state_dict(self, state: Any, strict: bool) -> Any:
                self.calls.append((state, strict))
                return LoadResult()

        class FakeTorch:
            def __init__(self) -> None:
                self.calls: list[tuple[Any, Any, Any]] = []

            def load(
                self,
                path: str,
                *,
                map_location: str,
                weights_only: bool,
            ) -> Any:
                self.calls.append((path, map_location, weights_only))
                return {"model": {"weight": object()}}

        model = FakeModel()
        torch = FakeTorch()
        load_reviewed_checkpoint(torch, model)
        self.assertEqual(
            torch.calls,
            [
                (
                    "/opt/fabrica/sam/checkpoints/"
                    "sam2.1_hiera_base_plus.pt",
                    "cpu",
                    True,
                )
            ],
        )
        self.assertEqual(len(model.calls), 1)
        self.assertFalse(model.calls[0][1])

    def test_reviewed_checkpoint_rejects_shape_and_key_drift(self) -> None:
        class LoadResult:
            def __init__(
                self,
                missing: Sequence[str] = (),
                unexpected: Sequence[str] = (),
            ) -> None:
                self.missing_keys = list(missing)
                self.unexpected_keys = list(unexpected)

        class FakeModel:
            def __init__(self, result: Any = None) -> None:
                self.result = result or LoadResult()

            def load_state_dict(self, _state: Any, strict: bool) -> Any:
                self.strict = strict
                return self.result

        class FakeTorch:
            def __init__(self, payload: Any) -> None:
                self.payload = payload

            def load(self, *_args: Any, **_kwargs: Any) -> Any:
                return self.payload

        cases = (
            ({"model": {"weight": 1}, "foreign": {}}, FakeModel()),
            ({"model": {}}, FakeModel()),
            (
                {"model": {"weight": 1}},
                FakeModel(LoadResult(missing=("missing",))),
            ),
            (
                {"model": {"weight": 1}},
                FakeModel(LoadResult(unexpected=("foreign",))),
            ),
        )
        for payload, model in cases:
            with self.subTest(payload=payload):
                with self.assertRaises(RuntimeError):
                    load_reviewed_checkpoint(FakeTorch(payload), model)

    def test_queue_wrapper_is_not_a_sam_request(self) -> None:
        with self.assertRaises(ContractError):
            parse_request({"id": "job", "input": request()})


class DirectRuntimeTests(unittest.TestCase):
    def test_cached_startup_states_are_terminal_and_load_once(self) -> None:
        class LoadEngine(FakeEngine):
            def __init__(self, should_fail: bool = False) -> None:
                super().__init__([])
                self.loads = 0
                self.should_fail = should_fail

            def load(self) -> None:
                self.loads += 1
                if self.should_fail:
                    raise RuntimeError("private startup detail")

        ready_engine = LoadEngine()
        ready = SamWorkerRuntime(ready_engine, MODEL_STAGED_NOT_LOADED)
        ready.load_model_once()
        ready.load_model_once()
        self.assertEqual(ready.readiness_state(), MODEL_LOADED_READY)
        self.assertEqual(ready_engine.loads, 1)

        failed_engine = LoadEngine(should_fail=True)
        failed = SamWorkerRuntime(failed_engine, MODEL_STAGED_NOT_LOADED)
        failed.load_model_once()
        failed.load_model_once()
        self.assertEqual(failed.readiness_state(), STARTUP_BLOCKED)
        self.assertEqual(failed_engine.loads, 1)

        absent_engine = LoadEngine()
        absent = SamWorkerRuntime(absent_engine, MODEL_NOT_STAGED)
        absent.load_model_once()
        self.assertEqual(absent.readiness_state(), MODEL_NOT_STAGED)
        self.assertEqual(absent_engine.loads, 0)

    def test_startup_state_logs_are_fixed_and_redacted(self) -> None:
        self.assertEqual(
            STARTUP_STATE_LOG_MESSAGES,
            {
                MODEL_NOT_STAGED: (
                    "fabrica-sam-startup-state: model-not-staged"
                ),
                MODEL_STAGED_NOT_LOADED: (
                    "fabrica-sam-startup-state: model-staged-not-loaded"
                ),
                MODEL_LOADED_READY: (
                    "fabrica-sam-startup-state: model-loaded-ready"
                ),
                STARTUP_BLOCKED: (
                    "fabrica-sam-startup-state: startup-blocked"
                ),
            },
        )

        class ReadyEngine(FakeEngine):
            def load(self) -> None:
                return None

        with patch(
            "sam_worker.runtime._STARTUP_LOGGER.info"
        ) as startup_log:
            ready = SamWorkerRuntime(
                ReadyEngine([]),
                MODEL_STAGED_NOT_LOADED,
            )
            ready.load_model_once()
            ready.load_model_once()
            startup_log.assert_called_once_with(
                "fabrica-sam-startup-state: model-loaded-ready"
            )

        exception_rendered = False

        class HostileStartupError(Exception):
            def __str__(self) -> str:
                nonlocal exception_rendered
                exception_rendered = True
                return "/private/checkpoint CUDA raw startup value"

        class BlockedEngine(FakeEngine):
            def load(self) -> None:
                raise HostileStartupError()

        with patch(
            "sam_worker.runtime._STARTUP_LOGGER.info"
        ) as startup_log:
            blocked = SamWorkerRuntime(
                BlockedEngine([]),
                MODEL_STAGED_NOT_LOADED,
            )
            blocked.load_model_once()
            blocked.load_model_once()
            startup_log.assert_called_once_with(
                "fabrica-sam-startup-state: startup-blocked"
            )
        self.assertFalse(exception_rendered)

    def test_production_staging_classification_rejects_partial_artifacts(self) -> None:
        def state_for(
            staged: tuple[
                bool,
                bool,
                bool,
                bool,
                bool,
                bool,
                bool,
                bool,
                bool,
                bool,
                bool,
                bool,
            ],
            *,
            preflight_error: Exception | None = None,
        ) -> str:
            with (
                patch(
                    "sam_worker.runtime._artifact_path_exists",
                    side_effect=staged,
                ),
                patch(
                    "sam_worker.runtime.preflight_runtime_artifacts",
                    side_effect=preflight_error,
                ) as preflight,
                patch(
                    "sam_worker.runtime.ProductionSamEngine",
                    return_value=FakeEngine([]),
                ),
                patch(
                    "sam_worker.runtime._STARTUP_LOGGER.info"
                ) as startup_log,
            ):
                state = create_production_runtime().readiness_state()
                self.assertEqual(
                    preflight.call_count, 1 if all(staged) else 0
                )
                startup_log.assert_called_once_with(
                    STARTUP_STATE_LOG_MESSAGES[state]
                )
                return state

        self.assertEqual(
            state_for((False,) * 12),
            MODEL_NOT_STAGED,
        )
        self.assertEqual(
            state_for((True,) * 12),
            MODEL_STAGED_NOT_LOADED,
        )
        self.assertEqual(
            state_for(
                (True,) * 12,
                preflight_error=ArtifactError("drift"),
            ),
            STARTUP_BLOCKED,
        )
        for missing_index in range(12):
            staged = tuple(
                index != missing_index for index in range(12)
            )
            self.assertEqual(state_for(staged), STARTUP_BLOCKED)

    def test_inference_admission_is_nonblocking_and_released_after_work(self) -> None:
        entered = threading.Event()
        release = threading.Event()

        class SlowEngine(FakeEngine):
            def segment(self, _validated: Any) -> Sequence[Mapping[str, Any]]:
                entered.set()
                if not release.wait(2):
                    raise RuntimeError("test did not release fake engine")
                return [
                    {
                        "mask": rectangle(10, 10, 1, 1, 5, 5),
                        "predictedIou": 0.9,
                        "stabilityScore": 0.9,
                    }
                ]

        runtime = SamWorkerRuntime(SlowEngine([]), MODEL_LOADED_READY)
        self.assertTrue(runtime.try_admit())
        result: list[Mapping[str, Any]] = []
        thread = threading.Thread(
            target=lambda: result.append(
                runtime.infer_and_release(parse_request(request()))
            )
        )
        thread.start()
        self.assertTrue(entered.wait(1))
        self.assertFalse(runtime.try_admit())
        release.set()
        thread.join(2)
        self.assertFalse(thread.is_alive())
        self.assertEqual(result[0]["candidateCount"], 1)
        self.assertTrue(runtime.try_admit())
        runtime.release_admission()

    def test_server_port_and_health_environment_are_strict(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(validated_port(), 80)
        with patch.dict(
            os.environ,
            {"PORT": "8080", "PORT_HEALTH": "8080", "HEALTH_CHECK_PATH": "/ping"},
            clear=True,
        ):
            self.assertEqual(validated_port(), 8080)
        for environment in (
            {"PORT": "0"},
            {"PORT": "080"},
            {"PORT": "65536"},
            {"PORT": "80 "},
            {"PORT": "80", "PORT_HEALTH": "81"},
            {"PORT": "80", "HEALTH_CHECK_PATH": "/health"},
        ):
            with patch.dict(os.environ, environment, clear=True):
                with self.assertRaises(RuntimeError):
                    validated_port()


class SelectedConfigAdapterTests(unittest.TestCase):
    def _selected_graph(self) -> Mapping[str, Any]:
        return {
            "model": {
                "_target_": "sam2.modeling.sam2_base.SAM2Base",
                "image_encoder": {
                    "_target_": (
                        "sam2.modeling.backbones.image_encoder.ImageEncoder"
                    ),
                    "trunk": {
                        "_target_": (
                            "sam2.modeling.backbones.hieradet.Hiera"
                        )
                    },
                    "neck": {
                        "_target_": (
                            "sam2.modeling.backbones.image_encoder.FpnNeck"
                        ),
                        "position_encoding": {
                            "_target_": (
                                "sam2.modeling.position_encoding."
                                "PositionEmbeddingSine"
                            )
                        },
                    },
                },
                "memory_attention": {
                    "_target_": (
                        "sam2.modeling.memory_attention.MemoryAttention"
                    ),
                    "layer": {
                        "_target_": (
                            "sam2.modeling.memory_attention."
                            "MemoryAttentionLayer"
                        ),
                        "self_attention": {
                            "_target_": (
                                "sam2.modeling.sam.transformer.RoPEAttention"
                            )
                        },
                        "cross_attention": {
                            "_target_": (
                                "sam2.modeling.sam.transformer.RoPEAttention"
                            )
                        },
                    },
                },
                "memory_encoder": {
                    "_target_": (
                        "sam2.modeling.memory_encoder.MemoryEncoder"
                    ),
                    "position_encoding": {
                        "_target_": (
                            "sam2.modeling.position_encoding."
                            "PositionEmbeddingSine"
                        )
                    },
                    "mask_downsampler": {
                        "_target_": (
                            "sam2.modeling.memory_encoder.MaskDownSampler"
                        )
                    },
                    "fuser": {
                        "_target_": (
                            "sam2.modeling.memory_encoder.Fuser"
                        ),
                        "layer": {
                            "_target_": (
                                "sam2.modeling.memory_encoder.CXBlock"
                            )
                        },
                    },
                },
            }
        }

    def test_fake_selected_graph_is_exact_and_applies_reviewed_overrides(
        self,
    ) -> None:
        calls: list[tuple[str, Mapping[str, Any]]] = []

        def constructor(path: str) -> Any:
            def build(**kwargs: Any) -> Mapping[str, Any]:
                calls.append((path, kwargs))
                return {"constructedAt": path, "kwargs": kwargs}

            return build

        constructors = {
            identity: constructor(identity[0])
            for identity in TARGET_INVENTORY
        }
        model = instantiate_reviewed_config(
            self._selected_graph(), constructors
        )
        self.assertEqual(model["constructedAt"], "model")
        self.assertEqual(
            model["kwargs"]["sam_mask_decoder_extra_args"],
            {
                "dynamic_multimask_stability_delta": 0.05,
                "dynamic_multimask_stability_thresh": 0.98,
                "dynamic_multimask_via_stability": True,
            },
        )
        self.assertEqual(
            {path for path, _kwargs in calls},
            {path for path, _target in TARGET_INVENTORY},
        )
        self.assertEqual(len(calls), 14)
        self.assertEqual(calls[-1][0], "model")

        missing = dict(constructors)
        del missing[TARGET_INVENTORY[-1]]
        with self.assertRaisesRegex(
            ModelConfigError, "constructor inventory"
        ):
            instantiate_reviewed_config(self._selected_graph(), missing)

        hydra_control = copy.deepcopy(self._selected_graph())
        hydra_control["model"]["_args_"] = []
        with self.assertRaisesRegex(
            ModelConfigError, "target inventory"
        ):
            instantiate_reviewed_config(hydra_control, constructors)

        preconfigured = copy.deepcopy(self._selected_graph())
        preconfigured["model"]["sam_mask_decoder_extra_args"] = {}
        with self.assertRaisesRegex(
            ModelConfigError, "postprocessing overrides"
        ):
            instantiate_reviewed_config(preconfigured, constructors)

    def test_reviewed_builder_moves_one_fake_model_and_enters_eval(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_root = root / "sam2-source"
            source_package = source_root / "sam2"
            source_package.mkdir(parents=True)
            overlay_root = root / "sam2-overlay"
            (overlay_root / "sam2").mkdir(parents=True)
            (overlay_root / "iopath/common").mkdir(parents=True)
            for path in (
                overlay_root / "sam2/__init__.py",
                overlay_root / "iopath/__init__.py",
                overlay_root / "iopath/common/__init__.py",
                overlay_root / "iopath/common/file_io.py",
            ):
                path.write_text("# fake reviewed origin\n", "utf-8")
            config_path = root / "config.yaml"
            config_path.write_bytes(b"x" * 3650)

            module_attributes = {
                "sam2.modeling.backbones.hieradet": ("Hiera",),
                "sam2.modeling.backbones.image_encoder": (
                    "FpnNeck",
                    "ImageEncoder",
                ),
                "sam2.modeling.memory_attention": (
                    "MemoryAttention",
                    "MemoryAttentionLayer",
                ),
                "sam2.modeling.memory_encoder": (
                    "CXBlock",
                    "Fuser",
                    "MaskDownSampler",
                    "MemoryEncoder",
                ),
                "sam2.modeling.position_encoding": (
                    "PositionEmbeddingSine",
                ),
                "sam2.modeling.sam.transformer": ("RoPEAttention",),
                "sam2.modeling.sam2_base": ("SAM2Base",),
            }
            modules: Dict[str, Any] = {}
            sam2_package = types.ModuleType("sam2")
            sam2_package.__file__ = str(
                overlay_root / "sam2/__init__.py"
            )
            sam2_package.__path__ = [str(source_package)]
            modules["sam2"] = sam2_package
            for package_name in (
                "sam2.modeling",
                "sam2.modeling.backbones",
                "sam2.modeling.sam",
            ):
                package = types.ModuleType(package_name)
                package.__path__ = [str(source_package)]
                modules[package_name] = package
            for module_name, attribute_names in module_attributes.items():
                module = types.ModuleType(module_name)
                module_path = source_package.joinpath(
                    *module_name.split(".")[1:]
                ).with_suffix(".py")
                module_path.parent.mkdir(parents=True, exist_ok=True)
                module_path.write_text("# fake constructor origin\n", "utf-8")
                module.__file__ = str(module_path)
                for attribute_name in attribute_names:
                    constructor = type(attribute_name, (), {})
                    constructor.__module__ = module_name
                    setattr(module, attribute_name, constructor)
                modules[module_name] = module

            iopath_package = types.ModuleType("iopath")
            iopath_package.__file__ = str(
                overlay_root / "iopath/__init__.py"
            )
            iopath_package.__path__ = [str(overlay_root / "iopath")]
            iopath_common = types.ModuleType("iopath.common")
            iopath_common.__file__ = str(
                overlay_root / "iopath/common/__init__.py"
            )
            iopath_common.__path__ = [
                str(overlay_root / "iopath/common")
            ]
            iopath_file_io = types.ModuleType(
                "iopath.common.file_io"
            )
            iopath_file_io.__file__ = str(
                overlay_root / "iopath/common/file_io.py"
            )
            iopath_package.common = iopath_common
            iopath_common.file_io = iopath_file_io
            modules.update(
                {
                    "iopath": iopath_package,
                    "iopath.common": iopath_common,
                    "iopath.common.file_io": iopath_file_io,
                    "yaml": types.ModuleType("yaml"),
                }
            )

            events: list[tuple[str, str | None]] = []

            class FakeModel:
                def to(self, device: str) -> "FakeModel":
                    events.append(("to", device))
                    return self

                def eval(self) -> None:
                    events.append(("eval", None))

            fake_model = FakeModel()

            class Digest:
                def hexdigest(self) -> str:
                    return (
                        "e73f9e9547b305040552ee943ebd3a34c"
                        "ee5727a76fc2ab88b87f7b28b430754"
                    )

            with (
                patch.dict(sys.modules, modules),
                patch(
                    "sam_worker.model_loader.IMAGE_CONFIG_PATH",
                    config_path,
                ),
                patch(
                    "sam_worker.model_loader.IMAGE_SOURCE_ROOT",
                    source_root,
                ),
                patch(
                    "sam_worker.model_loader.OVERLAY_ROOT",
                    overlay_root,
                ),
                patch(
                    "sam_worker.model_loader.hashlib.sha256",
                    return_value=Digest(),
                ),
                patch(
                    "sam_worker.model_loader.parse_reviewed_config",
                    return_value=self._selected_graph(),
                ),
                patch(
                    "sam_worker.model_loader.instantiate_reviewed_config",
                    return_value=fake_model,
                ) as instantiate,
            ):
                self.assertIs(build_reviewed_model("cuda"), fake_model)
            self.assertEqual(events, [("to", "cuda"), ("eval", None)])
            constructors = instantiate.call_args.args[1]
            self.assertEqual(set(constructors), set(TARGET_INVENTORY))
            self.assertEqual(len(constructors), 14)

    def test_constructor_origin_outside_reviewed_source_fails_redacted(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source/sam2"
            source.mkdir(parents=True)
            foreign_path = root / "foreign.py"
            foreign_path.write_text("# foreign\n", "utf-8")
            foreign_module = types.ModuleType("foreign_constructor")
            foreign_module.__file__ = str(foreign_path)
            constructor = type("Foreign", (), {})
            constructor.__module__ = foreign_module.__name__
            with patch.dict(
                sys.modules,
                {foreign_module.__name__: foreign_module},
            ):
                with self.assertRaisesRegex(
                    ModelConfigError,
                    "^Reviewed model target origin is invalid\\.$",
                ):
                    _verify_constructor_origins(
                        {("model", "foreign.Foreign"): constructor},
                        source,
                    )

    @unittest.skipUnless(
        YAML_TEST_DEPS_AVAILABLE,
        "the exact PyYAML runtime wheel is not installed on this bare host",
    )
    def test_yaml_parser_rejects_graph_features_and_target_drift(
        self,
    ) -> None:
        payload = (
            b"model:\n"
            b"  _target_: reviewed.Root\n"
            b"  child:\n"
            b"    _target_: reviewed.Child\n"
            b"    value: 1\n"
        )
        expected = {
            "model": {
                "_target_": "reviewed.Root",
                "child": {
                    "_target_": "reviewed.Child",
                    "value": 1,
                },
            }
        }
        digest = hashlib.sha256(
            json.dumps(
                expected,
                ensure_ascii=False,
                separators=(",", ":"),
                sort_keys=True,
                allow_nan=False,
            ).encode("utf-8")
        ).hexdigest()
        inventory = (
            ("model", "reviewed.Root"),
            ("model.child", "reviewed.Child"),
        )
        with (
            patch(
                "sam_worker.model_loader.PARSED_CONFIG_SHA256",
                digest,
            ),
            patch(
                "sam_worker.model_loader.TARGET_INVENTORY",
                inventory,
            ),
            patch(
                "sam_worker.model_loader.ALLOWED_TARGETS",
                frozenset(target for _path, target in inventory),
            ),
        ):
            self.assertEqual(parse_reviewed_config(payload, yaml), expected)

        for invalid in (
            b"model:\n  key: one\n  key: two\n",
            b"model: &model\n  child: *model\n",
            b"%YAML 1.2\n---\nmodel: {}\n",
            b"model: !!map {}\n",
            b"model:\n  <<: {foreign: true}\n",
            b"model:\n  value: ${env:SECRET}\n",
            b"model:\n  weights_path: /private/model.pt\n",
            b"model:\n  _target_: foreign.Target\n",
        ):
            with self.subTest(invalid=invalid):
                with self.assertRaises(ModelConfigError):
                    parse_reviewed_config(invalid, yaml)

    def test_iopath_overlay_refuses_before_inspecting_hostile_path(
        self,
    ) -> None:
        overlay = runpy.run_path(
            str(
                ROOT
                / "services/sam-worker/runtime-overlay/"
                "iopath/common/file_io.py"
            )
        )
        touched = False

        class HostilePath:
            def __fspath__(self) -> str:
                nonlocal touched
                touched = True
                raise AssertionError("secret path must not be inspected")

            def __str__(self) -> str:
                nonlocal touched
                touched = True
                return "/private/secret-checkpoint"

        with self.assertRaisesRegex(
            RuntimeError,
            "^External model weight access is disabled\\.$",
        ):
            overlay["g_pathmgr"].open(
                HostilePath(),
                token="top-secret",
            )
        self.assertFalse(touched)


try:
    from fastapi.testclient import TestClient

    from sam_worker.app import create_app

    FASTAPI_TEST_DEPS_AVAILABLE = True
except ModuleNotFoundError:
    TestClient = Any  # type: ignore[misc,assignment]
    create_app = None  # type: ignore[assignment]
    FASTAPI_TEST_DEPS_AVAILABLE = False


@unittest.skipUnless(
    FASTAPI_TEST_DEPS_AVAILABLE,
    "pinned FastAPI/httpx test intentions are not installed on this bare host",
)
class DirectHttpTests(unittest.TestCase):
    def test_health_is_redacted_and_nonready_until_model_is_ready(self) -> None:
        ready = SamWorkerRuntime(FakeEngine([]), MODEL_LOADED_READY)
        with TestClient(create_app(ready)) as client:
            response = client.get("/ping")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(
                response.json(),
                {
                    "contractVersion": "sam-runpod-direct-hosting-v1",
                    "processAlive": True,
                    "contractLoaded": True,
                    "state": "model-loaded-ready",
                    "inferenceReady": True,
                    "hostingProfileSha256": DIRECT_HOSTING_PROFILE_SHA256,
                },
            )
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertEqual(
                response.headers["content-type"],
                "application/json",
            )
            self.assertNotIn("retry-after", response.headers)

        for state in (MODEL_NOT_STAGED, STARTUP_BLOCKED):
            with TestClient(create_app(SamWorkerRuntime(FakeEngine([]), state))) as client:
                response = client.get("/ping")
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.json()["state"], state)
                self.assertFalse(response.json()["inferenceReady"])
                self.assertEqual(
                    response.headers["cache-control"],
                    "no-store",
                )
                self.assertNotIn("retry-after", response.headers)
                self.assertNotIn("path", response.text.lower())
                self.assertNotIn("exception", response.text.lower())
                refused = client.post("/v1/masks")
                self.assertEqual(refused.status_code, 503)
                self.assertEqual(
                    refused.json()["error"]["code"],
                    "WORKER_NOT_READY",
                )

        unknown = SamWorkerRuntime(FakeEngine([]), MODEL_NOT_STAGED)
        with unknown._state_lock:
            unknown._state = "/private/unknown-startup-value"
        with TestClient(create_app(unknown)) as client:
            response = client.get("/ping")
            self.assertEqual(response.status_code, 503)
            self.assertEqual(
                response.json()["state"],
                STARTUP_BLOCKED,
            )
            self.assertNotIn("private", response.text.lower())
            self.assertNotIn("unknown", response.text.lower())
            self.assertEqual(
                response.headers["cache-control"],
                "no-store",
            )
            self.assertNotIn("retry-after", response.headers)
            refused = client.post("/v1/masks")
            self.assertEqual(refused.status_code, 503)
            self.assertEqual(
                refused.json()["error"]["code"],
                "WORKER_NOT_READY",
            )

        loading_started = threading.Event()
        finish_loading = threading.Event()

        class LoadingEngine(FakeEngine):
            def load(self) -> None:
                loading_started.set()
                if not finish_loading.wait(2):
                    raise RuntimeError("test loader timed out")

        loading = SamWorkerRuntime(LoadingEngine([]), MODEL_STAGED_NOT_LOADED)
        with TestClient(create_app(loading)) as client:
            self.assertTrue(loading_started.wait(1))
            response = client.get("/ping")
            self.assertEqual(response.status_code, 204)
            self.assertEqual(response.content, b"")
            self.assertNotIn("content-type", response.headers)
            self.assertNotIn("content-length", response.headers)
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertNotIn("retry-after", response.headers)
            self.assertFalse(finish_loading.is_set())
            refused = client.post("/v1/masks")
            self.assertEqual(refused.status_code, 503)
            self.assertEqual(
                refused.json()["error"]["code"],
                "WORKER_NOT_READY",
            )
            finish_loading.set()
            for _attempt in range(100):
                response = client.get("/ping")
                if response.status_code == 200:
                    break
                time.sleep(0.005)
            self.assertEqual(response.status_code, 200)

        blocked_loading_started = threading.Event()
        finish_blocked_loading = threading.Event()

        class BlockedEngine(FakeEngine):
            def load(self) -> None:
                blocked_loading_started.set()
                if not finish_blocked_loading.wait(2):
                    raise RuntimeError("test blocked loader timed out")
                raise RuntimeError(
                    "/private/model/checkpoint.pt CUDA startup exception"
                )

        blocked = SamWorkerRuntime(BlockedEngine([]), MODEL_STAGED_NOT_LOADED)
        with TestClient(create_app(blocked)) as client:
            self.assertTrue(blocked_loading_started.wait(1))
            response = client.get("/ping")
            self.assertEqual(response.status_code, 204)
            self.assertEqual(response.content, b"")
            self.assertNotIn("content-type", response.headers)
            self.assertNotIn("content-length", response.headers)
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertNotIn("retry-after", response.headers)
            refused = client.post("/v1/masks")
            self.assertEqual(refused.status_code, 503)
            self.assertEqual(
                refused.json()["error"]["code"],
                "WORKER_NOT_READY",
            )
            finish_blocked_loading.set()
            for _attempt in range(100):
                response = client.get("/ping")
                if response.status_code == 503:
                    break
                time.sleep(0.005)
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json()["state"], STARTUP_BLOCKED)
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertNotIn("retry-after", response.headers)
            self.assertNotIn("checkpoint", response.text.lower())
            self.assertNotIn("cuda", response.text.lower())

    def test_direct_route_accepts_only_bare_strict_json(self) -> None:
        candidate = {
            "mask": rectangle(10, 10, 1, 1, 5, 5),
            "predictedIou": 0.9,
            "stabilityScore": 0.9,
        }
        runtime = SamWorkerRuntime(FakeEngine([candidate]), MODEL_LOADED_READY)
        with TestClient(create_app(runtime), follow_redirects=False) as client:
            valid = request()
            response = client.post(
                "/v1/masks",
                content=json.dumps(valid, separators=(",", ":")),
                headers={"content-type": "application/json"},
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["requestId"], valid["requestId"])
            self.assertEqual(response.json()["candidateCount"], 1)

            for path in (
                "/v1/masks/",
                "/v1/masks?foreign=1",
                "/docs",
                "/openapi.json",
                "/run",
                "/runsync",
            ):
                self.assertEqual(client.post(path).status_code, 404)
            self.assertEqual(client.get("/v1/masks").status_code, 405)
            self.assertEqual(client.post("/ping").status_code, 405)
            self.assertEqual(client.head("/ping").status_code, 405)
            self.assertEqual(client.options("/v1/masks").status_code, 405)

            for headers in (
                {"content-type": "multipart/form-data"},
                {"content-type": "application/json; charset=utf-8"},
                {
                    "content-type": "application/json",
                    "content-encoding": "identity",
                },
            ):
                self.assertEqual(
                    client.post("/v1/masks", content=b"{}", headers=headers).status_code,
                    415,
                )

            queue_wrapper = {"id": "legacy-queue-job", "input": valid}
            self.assertEqual(
                client.post(
                    "/v1/masks",
                    content=json.dumps(queue_wrapper),
                    headers={"content-type": "application/json"},
                ).status_code,
                400,
            )
            foreign = dict(valid)
            foreign["url"] = "https://example.invalid/source.png"
            self.assertEqual(
                client.post(
                    "/v1/masks",
                    content=json.dumps(foreign),
                    headers={"content-type": "application/json"},
                ).status_code,
                400,
            )
            encoded = json.dumps(valid, separators=(",", ":"))
            duplicate = '{"contractVersion":"sam-mask-v1",' + encoded[1:]
            self.assertEqual(
                client.post(
                    "/v1/masks",
                    content=duplicate,
                    headers={"content-type": "application/json"},
                ).status_code,
                400,
            )
            self.assertEqual(
                client.post(
                    "/v1/masks",
                    content=b" " * (MAX_REQUEST_JSON_BYTES + 1),
                    headers={"content-type": "application/json"},
                ).status_code,
                413,
            )
            nonfinite = encoded.replace('"width":10', '"width":NaN', 1)
            self.assertEqual(
                client.post(
                    "/v1/masks",
                    content=nonfinite,
                    headers={"content-type": "application/json"},
                ).status_code,
                400,
            )
            self.assertEqual(
                client.post(
                    "/v1/masks",
                    content=b"\xff",
                    headers={"content-type": "application/json"},
                ).status_code,
                400,
            )

    def test_overload_rejects_before_calling_asgi_receive(self) -> None:
        runtime = SamWorkerRuntime(FakeEngine([]), MODEL_LOADED_READY)
        application = create_app(runtime)
        self.assertTrue(runtime.try_admit())
        messages: list[Mapping[str, Any]] = []

        async def exercise() -> None:
            async def receive() -> Mapping[str, Any]:
                raise AssertionError("overloaded request body must not be received")

            async def send(message: Mapping[str, Any]) -> None:
                messages.append(message)

            await application(
                {
                    "type": "http",
                    "asgi": {"version": "3.0"},
                    "http_version": "1.1",
                    "method": "POST",
                    "scheme": "https",
                    "path": "/v1/masks",
                    "raw_path": b"/v1/masks",
                    "query_string": b"",
                    "root_path": "",
                    "headers": [(b"content-type", b"application/json")],
                    "client": ("127.0.0.1", 1),
                    "server": ("worker", 80),
                },
                receive,
                send,
            )

        try:
            asyncio.run(exercise())
        finally:
            runtime.release_admission()
        start = next(message for message in messages if message["type"] == "http.response.start")
        self.assertEqual(start["status"], 429)

    def test_overload_does_not_buffer_and_ping_stays_ready(self) -> None:
        entered = threading.Event()
        release = threading.Event()

        class SlowEngine(FakeEngine):
            def segment(self, _validated: Any) -> Sequence[Mapping[str, Any]]:
                entered.set()
                if not release.wait(2):
                    raise RuntimeError("test did not release fake inference")
                return [
                    {
                        "mask": rectangle(10, 10, 1, 1, 5, 5),
                        "predictedIou": 0.9,
                        "stabilityScore": 0.9,
                    }
                ]

        runtime = SamWorkerRuntime(SlowEngine([]), MODEL_LOADED_READY)
        with TestClient(create_app(runtime)) as client:
            first: list[Any] = []
            thread = threading.Thread(
                target=lambda: first.append(
                    client.post(
                        "/v1/masks",
                        content=json.dumps(request()),
                        headers={"content-type": "application/json"},
                    )
                )
            )
            thread.start()
            self.assertTrue(entered.wait(1))
            self.assertEqual(client.get("/ping").status_code, 200)
            overloaded = client.post(
                "/v1/masks",
                content=json.dumps(request()),
                headers={"content-type": "application/json"},
            )
            self.assertEqual(overloaded.status_code, 429)
            self.assertEqual(overloaded.json()["error"]["code"], "WORKER_OVERLOADED")
            self.assertNotIn("retry-after", overloaded.headers)
            release.set()
            thread.join(2)
            self.assertFalse(thread.is_alive())
            self.assertEqual(first[0].status_code, 200)

    def test_engine_errors_are_sanitized(self) -> None:
        class RaisingEngine(FakeEngine):
            def segment(self, _validated: Any) -> Sequence[Mapping[str, Any]]:
                raise RuntimeError(
                    "/private/model/checkpoint.pt CUDA secret exception detail"
                )

        runtime = SamWorkerRuntime(RaisingEngine([]), MODEL_LOADED_READY)
        with TestClient(create_app(runtime), raise_server_exceptions=False) as client:
            response = client.post(
                "/v1/masks",
                content=json.dumps(request()),
                headers={"content-type": "application/json"},
            )
            self.assertEqual(response.status_code, 500)
            self.assertEqual(response.json()["error"]["code"], "INFERENCE_FAILED")
            self.assertNotIn("checkpoint", response.text.lower())
            self.assertNotIn("cuda", response.text.lower())
            self.assertNotIn("secret", response.text.lower())


class StaticSourceTests(unittest.TestCase):
    def test_worker_runtime_source_has_no_network_or_eager_model_import(self) -> None:
        worker = ROOT / "services/sam-worker/sam_worker"
        protocol_source = (worker / "protocol.py").read_text("utf-8")
        engine_source = (worker / "engine.py").read_text("utf-8")
        app_source = (worker / "app.py").read_text("utf-8")
        runtime_source = (worker / "runtime.py").read_text("utf-8")
        hosting_source = (worker / "hosting.py").read_text("utf-8")
        server_source = (worker / "server.py").read_text("utf-8")
        health_source = (worker / "health.py").read_text("utf-8")
        loader_source = (worker / "model_loader.py").read_text("utf-8")
        boundary_source = app_source + runtime_source + hosting_source + server_source
        all_source = (
            protocol_source
            + engine_source
            + boundary_source
            + health_source
            + loader_source
        )
        for forbidden in (
            "\nimport requests",
            "\nfrom requests",
            "requests.get(",
            "requests.post(",
            "\nimport urllib",
            "\nfrom urllib",
            "\nimport socket",
            "\nfrom socket",
            "\nimport http.client",
            "\nfrom http.client",
        ):
            self.assertNotIn(forbidden, all_source)
        self.assertNotIn("import torch", protocol_source + boundary_source)
        self.assertNotIn("import sam2", protocol_source + boundary_source)
        self.assertNotIn("download", protocol_source.lower())
        self.assertNotIn("runpod.serverless", all_source)
        self.assertNotIn('"/runsync"', all_source)
        self.assertNotIn('"/run"', all_source)
        self.assertFalse((worker / "handler.py").exists())
        self.assertLess(
            app_source.index("if not runtime.try_admit():"),
            app_source.index("body = await _read_bounded_body(request)"),
        )
        self.assertIn("redirect_slashes=False", app_source)
        self.assertIn("docs_url=None", app_source)
        self.assertIn("redoc_url=None", app_source)
        self.assertIn("openapi_url=None", app_source)
        self.assertEqual(
            app_source.count(
                "asyncio.to_thread(runtime.load_model_once)"
            ),
            1,
        )
        self.assertIn(
            'logging.getLogger("uvicorn.error")',
            runtime_source,
        )
        self.assertNotIn("exc_info", runtime_source)
        self.assertNotIn(".exception(", runtime_source)
        for message in STARTUP_STATE_LOG_MESSAGES.values():
            self.assertIn(message, runtime_source)
        self.assertIn("access_log=False", server_source)
        self.assertIn("workers=1", server_source)
        load_body = engine_source[engine_source.index("    def load(self)") :]
        self.assertLess(
            load_body.index("self._manifest = validate_model_artifacts()"),
            load_body.index("            import torch"),
        )
        self.assertLess(
            load_body.index("self._manifest = validate_model_artifacts()"),
            load_body.index("            import sam2."),
        )
        self.assertNotIn(
            "import torch",
            engine_source[: engine_source.index("    def load(self)")],
        )
        self.assertIn("build_reviewed_model(self._device)", load_body)
        self.assertNotIn("import hydra", loader_source.lower())
        self.assertNotIn("import omegaconf", loader_source.lower())
        self.assertNotIn("importlib", loader_source)
        self.assertIn("load_reviewed_checkpoint(torch, model)", load_body)
        self.assertIn("weights_only=True", engine_source)
        self.assertIn('set(payload) != {"model"}', engine_source)
        self.assertIn("self._official_process_batch(", engine_source)
        self.assertIn("materialize_guarded_automatic_rles(", engine_source)
        self.assertIn('del batch_data["low_res_masks"]', engine_source)
        self.assertIn('delattr(generator, "_process_batch")', engine_source)

    def test_dockerfile_requires_controlled_pinned_inputs_and_nonroot_runtime(self) -> None:
        dockerfile = (ROOT / "services/sam-worker/Dockerfile").read_text("utf-8")
        acquisition_source = (
            ROOT / "services/sam-worker/acquire_build.py"
        ).read_text("utf-8")
        health_source = (
            ROOT / "services/sam-worker/sam_worker/health.py"
        ).read_text("utf-8")
        immutable_base = (
            "pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime@sha256:"
            "c8268a92a69bd500f8be0e665b2630ee006dadaf7bfbc24249141b15ff622755"
        )
        self.assertEqual(
            dockerfile.count(
                f"FROM --platform=linux/amd64 {immutable_base}"
            ),
            2,
        )
        self.assertIn("AS acquisition", dockerfile)
        self.assertIn("AS runtime", dockerfile)
        self.assertIn("ARG FABRICA_GIT_SHA=unavailable", dockerfile)
        self.assertIn("value != '0' * 40", dockerfile)
        self.assertLess(
            dockerfile.index("value == 'unavailable'"),
            dockerfile.index("LABEL org.opencontainers.image.source"),
        )
        self.assertIn("git-sha40-or-unavailable-v1", dockerfile)
        self.assertIn(
            'io.fabrica.image-use="health-only-non-promotable-v1"',
            dockerfile,
        )
        reviewed_manifest = json.loads(
            (
                ROOT / "services/sam-worker/artifact-manifest.json"
            ).read_text("utf-8")
        )
        adapter_profile = json.loads(
            (
                ROOT / "services/sam-worker/adapter-profile.json"
            ).read_text("utf-8")
        )
        labels = dict(
            re.findall(
                r'(org[.]opencontainers[.]image[.][a-z-]+|'
                r'io[.]fabrica[.][a-z0-9.-]+)="([^"]*)"',
                dockerfile,
            )
        )
        self.assertEqual(
            labels,
            {
                "org.opencontainers.image.source": (
                    "https://github.com/moodworks/fabrica-kit"
                ),
                "org.opencontainers.image.revision": (
                    "${FABRICA_GIT_SHA}"
                ),
                "io.fabrica.source-revision-contract": (
                    "git-sha40-or-unavailable-v1"
                ),
                "io.fabrica.image-use": (
                    "health-only-non-promotable-v1"
                ),
                "io.fabrica.build-contract.version": (
                    "fabrica-sam-runpod-github-v1"
                ),
                "io.fabrica.sam.repository-commit": (
                    reviewed_manifest["repository"]["commit"]
                ),
                "io.fabrica.sam.model-id": (
                    reviewed_manifest["model"]["modelId"]
                ),
                "io.fabrica.sam.config": (
                    reviewed_manifest["config"]["runtimeIdentity"]
                ),
                "io.fabrica.sam.config-sha256": (
                    reviewed_manifest["config"]["sha256"]
                ),
                "io.fabrica.sam.checkpoint-sha256": (
                    reviewed_manifest["checkpoint"]["sha256"]
                ),
                "io.fabrica.sam.artifact-manifest-sha256": (
                    reviewed_manifest["manifestSha256"]
                ),
                "io.fabrica.sam.hosting-profile-sha256": (
                    DIRECT_HOSTING_PROFILE_SHA256
                ),
                "io.fabrica.sam.direct-adapter-profile-sha256": (
                    "c114b8b0bc3030ef2d7df524c88bd1710c9e6bc264d186c6b9e8ee7845718747"
                ),
                "io.fabrica.sam.runtime-adapter-profile-sha256": (
                    adapter_profile["profileSha256"]
                ),
            },
        )
        run_instructions: list[str] = []
        current: list[str] = []
        for line in dockerfile.splitlines():
            if line.startswith("RUN "):
                current = [line]
            elif current:
                current.append(line)
            if current and not current[-1].endswith("\\"):
                run_instructions.append("\n".join(current))
                current = []
        self.assertFalse(current)
        invariant_markers = (
            "fabrica-build-gate: acquisition-cpython-major-minor",
            "fabrica-build-gate: source-revision",
            "fabrica-build-gate: runtime-cpython-major-minor",
            "fabrica-build-gate: torch-metadata-",
            "fabrica-build-gate: torchvision-metadata-",
            "groupadd --gid 10001 fabrica",
            "fabrica-build-gate: runtime-user-",
        )
        invariant_positions = []
        for marker in invariant_markers:
            matching = [
                index
                for index, instruction in enumerate(run_instructions)
                if marker in instruction
            ]
            self.assertEqual(len(matching), 1, marker)
            invariant_positions.append(matching[0])
        self.assertEqual(
            invariant_positions,
            sorted(set(invariant_positions)),
        )
        invariant_runs = [
            run_instructions[index] for index in invariant_positions
        ]
        self.assertTrue(
            all("--network=none" in instruction for instruction in invariant_runs)
        )
        for instruction in invariant_runs:
            if "groupadd --gid 10001 fabrica" not in instruction:
                self.assertIn("SystemExit(", instruction)
            self.assertNotIn("assert ", instruction)
        self.assertIn(
            "sys.version_info[:2] != (3, 11)",
            invariant_runs[0],
        )
        self.assertIn(
            "sys.version_info[:2] != (3, 11)",
            invariant_runs[2],
        )
        self.assertIn(
            "metadata.version('torch')",
            invariant_runs[3],
        )
        self.assertIn("'2.5.1+cu124'", invariant_runs[3])
        self.assertIn(
            "metadata.version('torchvision')",
            invariant_runs[4],
        )
        self.assertIn("'0.20.1+cu124'", invariant_runs[4])
        for instruction in invariant_runs[3:5]:
            self.assertIn(
                "except metadata.PackageNotFoundError:",
                instruction,
            )
            self.assertNotRegex(
                instruction,
                r"\b(?:from|import) (?:torch|torchvision)\b",
            )
        self.assertIn(
            "(user.pw_uid, user.pw_gid, group.gr_gid) "
            "!= (10001, 10001, 10001)",
            invariant_runs[6],
        )
        self.assertEqual(
            set(
                re.findall(
                    r"SystemExit\('"
                    r"(fabrica-build-gate: [a-z0-9-]+)'\)",
                    "\n".join(invariant_runs),
                )
            ),
            {
                "fabrica-build-gate: acquisition-cpython-major-minor",
                "fabrica-build-gate: source-revision",
                "fabrica-build-gate: runtime-cpython-major-minor",
                "fabrica-build-gate: torch-metadata-missing",
                "fabrica-build-gate: torch-metadata-mismatch",
                "fabrica-build-gate: torchvision-metadata-missing",
                "fabrica-build-gate: torchvision-metadata-mismatch",
                "fabrica-build-gate: runtime-user-missing",
                "fabrica-build-gate: runtime-user-identity",
            },
        )
        self.assertEqual(
            sum("--network=default" in item for item in run_instructions),
            1,
        )
        self.assertTrue(
            all(
                "--network=" in instruction
                for instruction in run_instructions
            )
        )
        self.assertTrue(
            all(
                "--network=none" in instruction
                for instruction in run_instructions
                if "--network=default" not in instruction
            )
        )
        runtime_stage = dockerfile.split(" AS runtime", 1)[1]
        self.assertNotIn("--network=default", runtime_stage)
        self.assertLess(
            dockerfile.index("verify-dependencies"),
            dockerfile.index("python -m pip install"),
        )
        self.assertLess(
            dockerfile.index("python -m pip install"),
            dockerfile.index("verify-installed"),
        )
        self.assertLess(
            dockerfile.index("verify-installed"),
            dockerfile.index("verify-runtime"),
        )
        for required in (
            "--no-index",
            "--no-compile",
            "--find-links=file:///opt/fabrica/wheelhouse",
            "--require-hashes",
            "--only-binary=:all:",
            "--no-deps",
            "--target=/opt/fabrica/runtime-deps",
            "rm -rf /opt/fabrica/runtime-deps/bin",
            "test ! -e /opt/fabrica/runtime-deps/bin",
            "find /opt/fabrica/runtime-deps -type f -name '*.pyc' -delete",
            "find /opt/fabrica/runtime-deps -type d -name __pycache__ -empty -delete",
            "path.suffix == '.pyc' or path.name == '__pycache__'",
            "EXPOSE 80/tcp",
            "USER 10001:10001",
            "HEALTHCHECK NONE",
            'CMD ["python", "-m", "sam_worker.server"]',
            "io.fabrica.sam.artifact-manifest-sha256",
            'io.fabrica.sam.config-sha256="'
            "e73f9e9547b305040552ee943ebd3a34cee5727a76fc2ab88b87f7b28b430754"
            '"',
            "io.fabrica.sam.hosting-profile-sha256",
            "io.fabrica.sam.direct-adapter-profile-sha256",
            "io.fabrica.sam.runtime-adapter-profile-sha256",
        ):
            self.assertIn(required, dockerfile)
        self.assertEqual(
            reviewed_manifest["dependencies"]["buildStatus"],
            "reviewed-wheel-only-ready",
        )
        self.assertTrue(
            reviewed_manifest["dependencies"]["acquisitionOccurred"]
        )
        self.assertIn("urllib.request", acquisition_source)
        self.assertIn("_RejectRedirects", acquisition_source)
        self.assertIn("ProxyHandler({})", acquisition_source)
        acquisition_body = acquisition_source[
            acquisition_source.index("def acquire(") :
        ]
        self.assertLess(
            acquisition_body.index("verify_dependency_input_set("),
            acquisition_body.index("opener = build_opener("),
        )
        self.assertLess(
            acquisition_body.index("verify_dependency_input_set("),
            acquisition_body.index("_download("),
        )
        self.assertIn(
            'ARCHIVE_HOST = "codeload.github.com"',
            acquisition_source,
        )
        self.assertIn(
            'CHECKPOINT_HOST = "dl.fbaipublicfiles.com"',
            acquisition_source,
        )
        self.assertIn(
            'WHEEL_HOST = "files.pythonhosted.org"',
            acquisition_source,
        )
        self.assertIn("effective_url != url", acquisition_source)
        self.assertIn(
            '"Accept-Encoding": "identity"',
            acquisition_source,
        )
        self.assertIn(
            "expected_byte_size - observed_size + 1",
            acquisition_source,
        )
        self.assertIn("os.O_EXCL", acquisition_source)
        self.assertIn(
            'getattr(os, "O_NOFOLLOW", 0)',
            acquisition_source,
        )
        self.assertIn("0o444", acquisition_source)
        download_body = acquisition_source[
            acquisition_source.index("def _download(") :
            acquisition_source.index("def _copy_regular(")
        ]
        self.assertNotIn(
            'headers.get("Content-Length")',
            download_body,
        )
        self.assertNotIn(
            'headers.get("Transfer-Encoding")',
            download_body,
        )
        self.assertIn(
            "Content-Length and Transfer-Encoding are advisory",
            download_body,
        )
        self.assertNotIn("from error", download_body)
        self.assertEqual(acquisition_body.count("_download("), 3)
        for artifact_kind in ("archive", "checkpoint", "wheel"):
            self.assertEqual(
                acquisition_body.count(
                    f'artifact_kind="{artifact_kind}"'
                ),
                1,
            )
            for failure in (
                "url",
                "redirect",
                "response",
                "header",
                "stream-length",
                "digest",
                "transport",
                "destination",
            ):
                self.assertIn(
                    "fabrica-build-gate: acquisition-"
                    + artifact_kind
                    + "-"
                    + failure,
                    acquisition_source,
                )
        self.assertIn("verify_dependency_build_ready(", acquisition_source)
        self.assertIn("verify_runtime_artifacts(", acquisition_source)
        self.assertNotIn("runpod", acquisition_source.lower())
        self.assertNotIn("RUNPOD_API_KEY", acquisition_source)
        self.assertNotIn(".local-data", dockerfile)
        self.assertNotIn("COPY .git", dockerfile)
        self.assertNotIn(
            "COPY --from=acquisition /opt/fabrica/closed/wheelhouse ",
            dockerfile,
        )
        self.assertNotIn("acquire_build.py /opt/fabrica/worker", dockerfile)
        self.assertNotIn(
            "COPY --from=acquisition /opt/fabrica/build",
            dockerfile,
        )
        self.assertNotIn("tar --extract", dockerfile)
        self.assertNotIn("pip install .", dockerfile)
        for forbidden in ("curl ", "wget ", "git clone", ":latest", "RUNPOD_API_KEY"):
            self.assertNotIn(forbidden, dockerfile)
        runtime_requirements = (
            ROOT / "services/sam-worker/requirements.in"
        ).read_text("utf-8")
        self.assertIn("fastapi==0.115.12", runtime_requirements)
        self.assertIn("uvicorn==0.34.2", runtime_requirements)
        active_requirements = [
            line
            for line in runtime_requirements.splitlines()
            if line and not line.startswith("#")
        ]
        self.assertFalse(
            any(
                line.startswith(("torch==", "torchvision=="))
                for line in active_requirements
            )
        )
        self.assertIn(
            "torch==2.5.1+cu124 and torchvision==0.20.1+cu124",
            runtime_requirements,
        )
        self.assertNotIn("hydra-core", runtime_requirements)
        self.assertNotIn("omegaconf", runtime_requirements)
        self.assertNotIn("iopath", runtime_requirements)
        self.assertNotIn("runpod", runtime_requirements.lower())
        test_requirements = (
            ROOT / "services/sam-worker/requirements.test.in"
        ).read_text("utf-8")
        self.assertIn("httpx==0.28.1", test_requirements)
        dockerignore = (
            ROOT / "services/sam-worker/Dockerfile.dockerignore"
        ).read_text("utf-8").splitlines()
        self.assertEqual(
            dockerignore,
            [
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
            ],
        )
        required_context = {
            "!services/sam-worker/Dockerfile",
            "!services/sam-worker/artifact-manifest.json",
            "!services/sam-worker/adapter-profile.json",
            "!services/sam-worker/dependency-licenses.json",
            "!services/sam-worker/requirements.lock",
            "!services/sam-worker/wheelhouse-manifest.json",
            "!services/sam-worker/acquire_build.py",
            "!services/sam-worker/sam_worker/model_loader.py",
            "!services/sam-worker/runtime-overlay/iopath/common/file_io.py",
            "!services/sam-worker/runtime-overlay/sam2/__init__.py",
        }
        self.assertTrue(required_context.issubset(set(dockerignore)))
        for included in required_context:
            self.assertTrue(
                (ROOT / included[1:]).is_file(),
                included,
            )
        context_copy_sources = set(
            re.findall(
                r"^COPY (?!--from=)([^ ]+) ",
                dockerfile,
                flags=re.MULTILINE,
            )
        )
        self.assertEqual(
            context_copy_sources,
            {
                "services/sam-worker/sam_worker",
                "services/sam-worker/runtime-overlay",
                "services/sam-worker/artifact-manifest.json",
                "services/sam-worker/adapter-profile.json",
                "services/sam-worker/dependency-licenses.json",
                "services/sam-worker/requirements.lock",
                "services/sam-worker/wheelhouse-manifest.json",
                "services/sam-worker/acquire_build.py",
            },
        )
        for source in context_copy_sources:
            self.assertTrue((ROOT / source).exists(), source)
        self.assertFalse(
            any(".local-data" in line for line in dockerignore)
        )
        self.assertNotIn("!services/sam-worker/sam_worker/*.py", dockerignore)
        self.assertIn(
            "from .artifacts import",
            health_source,
        )
        self.assertNotIn("from .engine", health_source)
        self.assertNotIn("ProductionSamEngine", health_source)
        self.assertNotIn(".load(", health_source)
        for required in (
            "IMAGE_REQUIREMENTS_LOCK_PATH",
            "IMAGE_WHEELHOUSE_MANIFEST_PATH",
            "IMAGE_DEPENDENCY_LICENSES_PATH",
            "IMAGE_RUNTIME_DEPENDENCIES_ROOT",
        ):
            self.assertIn(required, health_source)
        self.assertEqual(
            [
                line
                for line in dockerfile.splitlines()
                if line.startswith("ARG ")
            ],
            ["ARG FABRICA_GIT_SHA=unavailable"],
        )
        for source in (dockerfile, acquisition_source):
            for forbidden in (
                "RUNPOD_API_KEY",
                "RUNPOD_API_URL",
                "api.runpod.io",
                "Authorization:",
            ):
                self.assertNotIn(forbidden, source)

    def test_docker_invariant_mutations_fail_with_fixed_diagnostics(
        self,
    ) -> None:
        dockerfile = (
            ROOT / "services/sam-worker/Dockerfile"
        ).read_text("utf-8")
        run_instructions: list[str] = []
        current: list[str] = []
        for line in dockerfile.splitlines():
            if line.startswith("RUN "):
                current = [line]
            elif current:
                current.append(line)
            if current and not current[-1].endswith("\\"):
                run_instructions.append("\n".join(current))
                current = []

        def instruction(marker: str) -> str:
            matching = [
                value for value in run_instructions if marker in value
            ]
            self.assertEqual(len(matching), 1, marker)
            return matching[0]

        def python_code(marker: str) -> str:
            tokens = shlex.split(
                instruction(marker).replace("\\\n", " ")
            )
            self.assertIn("-c", tokens)
            return tokens[tokens.index("-c") + 1]

        revision_code = python_code(
            "fabrica-build-gate: source-revision"
        )
        for value in (
            "unavailable",
            "1" * 40,
            "0123456789abcdef0123456789abcdef01234567",
        ):
            with self.subTest(valid_revision=value):
                with patch.object(sys, "argv", ["python", value]):
                    exec(revision_code, {})
        for value in (
            "",
            "0" * 40,
            "1" * 39,
            "1" * 41,
            "A" * 40,
            "g" * 40,
            " unavailable",
            "unavailable ",
            "refs/heads/main",
        ):
            with self.subTest(invalid_revision=value):
                with patch.object(sys, "argv", ["python", value]):
                    with self.assertRaisesRegex(
                        SystemExit,
                        "^fabrica-build-gate: source-revision$",
                    ):
                        exec(revision_code, {})

        for marker, distribution, expected in (
            (
                "fabrica-build-gate: torch-metadata-",
                "torch",
                "2.5.1+cu124",
            ),
            (
                "fabrica-build-gate: torchvision-metadata-",
                "torchvision",
                "0.20.1+cu124",
            ),
        ):
            code = python_code(marker)
            with self.subTest(distribution=distribution, result="exact"):
                with patch(
                    "importlib.metadata.version",
                    return_value=expected,
                ):
                    exec(code, {})
            with self.subTest(distribution=distribution, result="missing"):
                with patch(
                    "importlib.metadata.version",
                    side_effect=importlib.metadata.PackageNotFoundError,
                ):
                    with self.assertRaisesRegex(
                        SystemExit,
                        "^fabrica-build-gate: "
                        + distribution
                        + "-metadata-missing$",
                    ):
                        exec(code, {})
            with self.subTest(distribution=distribution, result="mismatch"):
                with patch(
                    "importlib.metadata.version",
                    return_value=expected.split("+", 1)[0],
                ):
                    with self.assertRaisesRegex(
                        SystemExit,
                        "^fabrica-build-gate: "
                        + distribution
                        + "-metadata-mismatch$",
                    ):
                        exec(code, {})

        identity_code = python_code(
            "fabrica-build-gate: runtime-user-"
        )
        exact_user = types.SimpleNamespace(
            pw_uid=10001,
            pw_gid=10001,
        )
        exact_group = types.SimpleNamespace(gr_gid=10001)
        with (
            patch("pwd.getpwnam", return_value=exact_user),
            patch("grp.getgrnam", return_value=exact_group),
        ):
            exec(identity_code, {})
        for user, group in (
            (
                types.SimpleNamespace(pw_uid=10002, pw_gid=10001),
                exact_group,
            ),
            (
                types.SimpleNamespace(pw_uid=10001, pw_gid=10002),
                exact_group,
            ),
            (
                exact_user,
                types.SimpleNamespace(gr_gid=10002),
            ),
        ):
            with self.subTest(user=user, group=group):
                with (
                    patch("pwd.getpwnam", return_value=user),
                    patch("grp.getgrnam", return_value=group),
                ):
                    with self.assertRaisesRegex(
                        SystemExit,
                        "^fabrica-build-gate: runtime-user-identity$",
                    ):
                        exec(identity_code, {})
        with patch("pwd.getpwnam", side_effect=KeyError):
            with self.assertRaisesRegex(
                SystemExit,
                "^fabrica-build-gate: runtime-user-missing$",
            ):
                exec(identity_code, {})

    def test_legacy_example_manifests_are_replaced_by_reviewed_manifest(
        self,
    ) -> None:
        worker = ROOT / "services/sam-worker"
        self.assertFalse((worker / "model-manifest.example.json").exists())
        self.assertFalse(
            (worker / "build-input-manifest.example.json").exists()
        )
        reviewed = json.loads(
            (worker / "artifact-manifest.json").read_text("utf-8")
        )
        self.assertEqual(
            reviewed["manifestKind"],
            "fabrica-sam-worker-reviewed-artifacts-v1",
        )
        self.assertEqual(
            reviewed["checkpoint"]["sha256"],
            "a2345aede8715ab1d5d31b4a509fb160c5a4af1970f199d9054ccfb746c004c5",
        )


if __name__ == "__main__":
    unittest.main()
