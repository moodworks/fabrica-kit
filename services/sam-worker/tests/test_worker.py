from __future__ import annotations

import asyncio
import base64
import binascii
import copy
import hashlib
import json
import math
import os
import struct
import sys
import threading
import time
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
from sam_worker.runtime import (
    MODEL_LOADED_READY,
    MODEL_NOT_STAGED,
    MODEL_STAGED_NOT_LOADED,
    STARTUP_BLOCKED,
    SamWorkerRuntime,
    create_production_runtime,
)
from sam_worker.server import validated_port

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

    def test_production_staging_classification_rejects_partial_artifacts(self) -> None:
        def state_for(
            staged: tuple[bool, bool, bool, bool, bool],
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
            ):
                state = create_production_runtime().readiness_state()
                self.assertEqual(
                    preflight.call_count, 1 if all(staged) else 0
                )
                return state

        self.assertEqual(
            state_for((False, False, False, False, False)),
            MODEL_NOT_STAGED,
        )
        self.assertEqual(
            state_for((True, True, True, True, True)),
            MODEL_STAGED_NOT_LOADED,
        )
        self.assertEqual(
            state_for(
                (True, True, True, True, True),
                preflight_error=ArtifactError("drift"),
            ),
            STARTUP_BLOCKED,
        )
        for missing_index in range(5):
            staged = tuple(
                index != missing_index for index in range(5)
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
    def test_health_states_are_cached_redacted_and_bodyless_while_loading(self) -> None:
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
            self.assertNotIn("retry-after", response.headers)

        for state in (MODEL_NOT_STAGED, STARTUP_BLOCKED):
            with TestClient(create_app(SamWorkerRuntime(FakeEngine([]), state))) as client:
                response = client.get("/ping")
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.json()["state"], state)
                self.assertFalse(response.json()["inferenceReady"])
                self.assertNotIn("path", response.text.lower())
                self.assertNotIn("exception", response.text.lower())

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
            self.assertNotIn("content-length", response.headers)
            self.assertNotIn("content-type", response.headers)
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertNotIn("retry-after", response.headers)
            finish_loading.set()
            for _attempt in range(100):
                response = client.get("/ping")
                if response.status_code == 200:
                    break
                time.sleep(0.005)
            self.assertEqual(response.status_code, 200)

        class BlockedEngine(FakeEngine):
            def load(self) -> None:
                raise RuntimeError(
                    "/private/model/checkpoint.pt CUDA startup exception"
                )

        blocked = SamWorkerRuntime(BlockedEngine([]), MODEL_STAGED_NOT_LOADED)
        with TestClient(create_app(blocked)) as client:
            for _attempt in range(100):
                response = client.get("/ping")
                if response.status_code == 503:
                    break
                time.sleep(0.005)
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json()["state"], STARTUP_BLOCKED)
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
        boundary_source = app_source + runtime_source + hosting_source + server_source
        all_source = protocol_source + engine_source + boundary_source + health_source
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
        self.assertIn("ckpt_path=None", load_body)
        self.assertIn("load_reviewed_checkpoint(torch, model)", load_body)
        self.assertIn("weights_only=True", engine_source)
        self.assertIn('set(payload) != {"model"}', engine_source)
        self.assertIn("self._official_process_batch(", engine_source)
        self.assertIn("materialize_guarded_automatic_rles(", engine_source)
        self.assertIn('del batch_data["low_res_masks"]', engine_source)
        self.assertIn('delattr(generator, "_process_batch")', engine_source)

    def test_dockerfile_requires_controlled_pinned_inputs_and_nonroot_runtime(self) -> None:
        dockerfile = (ROOT / "services/sam-worker/Dockerfile").read_text("utf-8")
        health_source = (
            ROOT / "services/sam-worker/sam_worker/health.py"
        ).read_text("utf-8")
        self.assertFalse(dockerfile.startswith("# syntax="))
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
        self.assertNotIn("ARG ", dockerfile)
        self.assertIn("--require-hashes", dockerfile)
        self.assertIn("--no-index", dockerfile)
        self.assertIn("audit-build", dockerfile)
        self.assertLess(
            dockerfile.index("python -m sam_worker.artifacts audit-build"),
            dockerfile.index("python -m pip install"),
        )
        ordered_fragments = (
            "python -m sam_worker.artifacts audit-build",
            "python -m pip install",
            "python -m sam_worker.artifacts extract-runtime",
            "install -m 0444",
            "python -m sam_worker.artifacts verify-runtime",
            "python -m sam_worker.health",
            "USER 10001:10001",
            'CMD ["python", "-m", "sam_worker.server"]',
        )
        ordered_positions = [
            dockerfile.index(fragment) for fragment in ordered_fragments
        ]
        self.assertEqual(ordered_positions, sorted(ordered_positions))
        reviewed_manifest = json.loads(
            (
                ROOT / "services/sam-worker/artifact-manifest.json"
            ).read_text("utf-8")
        )
        self.assertEqual(
            reviewed_manifest["dependencies"]["buildStatus"],
            "unresolved-deployment-time-blocking",
        )
        self.assertFalse(
            reviewed_manifest["dependencies"]["acquisitionOccurred"]
        )
        self.assertIn("pytorch-base-manifest.json", dockerfile)
        self.assertIn("pytorch-base-config.json", dockerfile)
        self.assertIn("wheelhouse-inventory.json", dockerfile)
        self.assertIn("--platform linux/amd64", dockerfile)
        self.assertIn("extract-runtime", dockerfile)
        self.assertIn("verify-runtime", dockerfile)
        self.assertIn("--target=/opt/fabrica/runtime-deps", dockerfile)
        self.assertIn("PIP_CONFIG_FILE=/dev/null", dockerfile)
        self.assertIn("--only-binary=:all:", dockerfile)
        self.assertIn("--no-deps", dockerfile)
        self.assertIn(
            "--find-links=file:///opt/fabrica/staged/wheelhouse",
            dockerfile,
        )
        self.assertNotIn("pip install --no-cache-dir --no-index --no-build-isolation", dockerfile)
        self.assertNotIn("tar --extract", dockerfile)
        self.assertNotIn("pip install .", dockerfile)
        self.assertNotIn("requirements.lock.sha256", dockerfile)
        self.assertNotIn("wheelhouse.sha256", dockerfile)
        self.assertNotIn(
            "COPY --from=artifact-audit /opt/fabrica/staged",
            dockerfile,
        )
        self.assertNotIn(
            "COPY --from=artifact-audit /opt/fabrica/sam2-source.tar.gz",
            dockerfile,
        )
        self.assertIn("USER 10001:10001", dockerfile)
        self.assertIn("python -m sam_worker.health", dockerfile)
        self.assertIn("HEALTHCHECK NONE", dockerfile)
        self.assertIn('CMD ["python", "-m", "sam_worker.server"]', dockerfile)
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
            "torch==2.5.1 and torchvision==0.20.1 are owned by the "
            "immutable base image",
            runtime_requirements,
        )
        self.assertNotIn("runpod", runtime_requirements.lower())
        test_requirements = (
            ROOT / "services/sam-worker/requirements.test.in"
        ).read_text("utf-8")
        self.assertIn("httpx==0.28.1", test_requirements)
        dockerignore = (
            ROOT / "services/sam-worker/Dockerfile.dockerignore"
        ).read_text("utf-8").splitlines()
        self.assertEqual(dockerignore[0], "**")
        self.assertEqual(
            set(dockerignore[1:]),
            {
                "!services/",
                "!services/sam-worker/",
                "!services/sam-worker/Dockerfile",
                "!services/sam-worker/artifact-manifest.json",
                "!services/sam-worker/sam_worker/",
                "!services/sam-worker/sam_worker/__init__.py",
                "!services/sam-worker/sam_worker/app.py",
                "!services/sam-worker/sam_worker/artifacts.py",
                "!services/sam-worker/sam_worker/engine.py",
                "!services/sam-worker/sam_worker/health.py",
                "!services/sam-worker/sam_worker/hosting.py",
                "!services/sam-worker/sam_worker/protocol.py",
                "!services/sam-worker/sam_worker/runtime.py",
                "!services/sam-worker/sam_worker/server.py",
                "!.local-data/",
                "!.local-data/banner-ai/",
                "!.local-data/banner-ai/sam-worker-build/",
                "!.local-data/banner-ai/sam-worker-build/requirements.lock",
                "!.local-data/banner-ai/sam-worker-build/"
                "wheelhouse-inventory.json",
                "!.local-data/banner-ai/sam-worker-build/wheelhouse/",
                "!.local-data/banner-ai/sam-worker-build/"
                "wheelhouse/*.whl",
                "!.local-data/banner-ai/sam-worker-build/"
                "sam2-source.tar.gz",
                "!.local-data/banner-ai/sam-worker-build/"
                "sam2.1_hiera_b+.yaml",
                "!.local-data/banner-ai/sam-worker-build/"
                "sam2.1_hiera_base_plus.pt",
                "!.local-data/banner-ai/sam-worker-build/LICENSE",
                "!.local-data/banner-ai/sam-worker-build/"
                "LICENSE_cctorch",
                "!.local-data/banner-ai/sam-worker-build/"
                "pytorch-base-manifest.json",
                "!.local-data/banner-ai/sam-worker-build/"
                "pytorch-base-config.json",
            },
        )
        self.assertFalse(
            any(
                token in line
                for line in dockerignore[1:]
                for token in (
                    "**",
                    ".git",
                    ".env",
                    "__pycache__",
                    "*.pyc",
                    "secrets",
                )
            )
        )
        self.assertNotIn("!services/sam-worker/sam_worker/*.py", dockerignore)
        self.assertNotIn(
            "!.local-data/banner-ai/sam-worker-build/**", dockerignore
        )
        self.assertIn(
            "from .artifacts import",
            health_source,
        )
        self.assertNotIn("from .engine", health_source)
        self.assertNotIn("ProductionSamEngine", health_source)
        self.assertNotIn(".load(", health_source)

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
