from __future__ import annotations

import base64
import binascii
import copy
import hashlib
import json
import math
import struct
import sys
import unittest
import zlib
from array import array
from pathlib import Path
from typing import Any, Dict, Mapping, Sequence

from sam_worker.handler import handle_job
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
    materialize_compact_automatic_candidates,
    materialize_guarded_automatic_rles,
)
from sam_worker.protocol import (
    MAX_RAW_MASK_WORKING_BYTES,
    ContractError,
    basis_point_to_pixel,
    box_basis_to_pixels,
    candidate_id,
    canonical_json,
    decode_rle,
    decode_strict_rgba_png,
    encode_rle,
    mask_digest,
    parse_request,
    postprocess,
)

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
        response = handle_job({"id": "fake-provider-job", "input": valid}, FakeEngine(candidates))
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
            handle_job({"id": "fake-provider-job", "input": request()}, FakeEngine(raw))

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
                handle_job(
                    {"id": "fake-provider-job", "input": valid_request},
                    FakeEngine([candidate]),
                )

        class InvalidIdentityEngine(FakeEngine):
            def execution_identity(self) -> Mapping[str, Any]:
                return {
                    "kind": "deterministic-fake",
                    "engineId": "INVALID",
                    "definitionSha256": "7" * 64,
                    "notice": "NOT_SAM_OUTPUT",
                }

        with self.assertRaisesRegex(ContractError, "honestly labelled"):
            handle_job(
                {"id": "fake-provider-job", "input": valid_request},
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

    def test_runpod_wrapper_is_closed(self) -> None:
        with self.assertRaises(ContractError):
            handle_job({"id": "job", "input": request(), "url": "https://example.invalid"}, FakeEngine([]))


class StaticSourceTests(unittest.TestCase):
    def test_worker_runtime_source_has_no_network_or_eager_model_import(self) -> None:
        worker = ROOT / "services/sam-worker/sam_worker"
        protocol_source = (worker / "protocol.py").read_text("utf-8")
        handler_source = (worker / "handler.py").read_text("utf-8")
        engine_source = (worker / "engine.py").read_text("utf-8")
        all_source = protocol_source + handler_source + engine_source
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
        self.assertNotIn("import torch", protocol_source + handler_source)
        self.assertNotIn("import sam2", protocol_source + handler_source)
        self.assertNotIn("download", protocol_source.lower())
        load_body = engine_source[engine_source.index("    def load(self)") :]
        self.assertLess(
            load_body.index("self._manifest = validate_model_artifacts()"),
            load_body.index("            import torch"),
        )
        self.assertNotIn(
            "import torch",
            engine_source[: engine_source.index("    def load(self)")],
        )
        self.assertIn("self._official_process_batch(", engine_source)
        self.assertIn("materialize_guarded_automatic_rles(", engine_source)
        self.assertIn('del batch_data["low_res_masks"]', engine_source)
        self.assertIn('delattr(generator, "_process_batch")', engine_source)

    def test_dockerfile_requires_controlled_pinned_inputs_and_nonroot_runtime(self) -> None:
        dockerfile = (ROOT / "services/sam-worker/Dockerfile").read_text("utf-8")
        self.assertFalse(dockerfile.startswith("# syntax="))
        self.assertIn("ARG PYTORCH_BASE_IMAGE", dockerfile)
        self.assertIn("FROM ${PYTORCH_BASE_IMAGE}", dockerfile)
        self.assertNotIn("ARG SAM_REPOSITORY_COMMIT", dockerfile)
        self.assertIn(
            "SAM_REPOSITORY_COMMIT=05d9e57fb3945b10c861046c1e6749e2bfc258e3",
            dockerfile,
        )
        self.assertIn("--require-hashes", dockerfile)
        self.assertIn("--no-index", dockerfile)
        self.assertIn("sam2-source.tar.gz.sha256", dockerfile)
        self.assertIn("sam2-source[.]tar[.]gz", dockerfile)
        self.assertIn('= "sam2-${SAM_REPOSITORY_COMMIT}"', dockerfile)
        self.assertNotIn("COPY .local-data/banner-ai/sam-worker-build/sam2-source ", dockerfile)
        self.assertIn("USER 10001:10001", dockerfile)
        self.assertIn("python -m sam_worker.health", dockerfile)
        for forbidden in ("curl ", "wget ", "git clone", ":latest", "RUNPOD_API_KEY"):
            self.assertNotIn(forbidden, dockerfile)
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
                "!services/sam-worker/sam_worker/",
                "!services/sam-worker/sam_worker/**",
                "!.local-data/",
                "!.local-data/banner-ai/",
                "!.local-data/banner-ai/sam-worker-build/",
                "!.local-data/banner-ai/sam-worker-build/**",
            },
        )
        self.assertFalse(any(".git" in line or ".env" in line for line in dockerignore))

    def test_runtime_model_manifest_example_is_the_exact_eight_key_contract(self) -> None:
        runtime_manifest = json.loads(
            (
                ROOT / "services/sam-worker/model-manifest.example.json"
            ).read_text("utf-8")
        )
        self.assertEqual(
            set(runtime_manifest),
            {
                "manifestVersion",
                "repositoryUrl",
                "repositoryCommit",
                "modelId",
                "configIdentity",
                "configSha256",
                "checkpointUrl",
                "checkpointSha256",
            },
        )
        self.assertEqual(len(runtime_manifest), 8)
        self.assertEqual(runtime_manifest["configSha256"], "REVIEWED_CONFIG_SHA256_REQUIRED")
        self.assertEqual(
            runtime_manifest["checkpointSha256"],
            "REVIEWED_CHECKPOINT_SHA256_REQUIRED",
        )
        build_ledger = json.loads(
            (
                ROOT / "services/sam-worker/build-input-manifest.example.json"
            ).read_text("utf-8")
        )
        self.assertIn("repositoryArchiveSha256", build_ledger)
        self.assertNotIn("modelId", build_ledger)


if __name__ == "__main__":
    unittest.main()
