"""Injectable engine port and the narrowly pinned production SAM 2.1 implementation."""

from __future__ import annotations

import gc
import math
import threading
from array import array
from typing import Any, Callable, Dict, List, Mapping, Sequence, Tuple

from .artifacts import (
    IMAGE_CHECKPOINT_PATH,
    IMAGE_CONFIG_PATH,
    IMAGE_LICENSE_ROOT,
    IMAGE_MANIFEST_PATH,
    IMAGE_SOURCE_ROOT,
    preflight_runtime_artifacts,
    verify_runtime_artifacts,
)
from .protocol import (
    MAX_RAW_CANDIDATES,
    MAX_RAW_MASK_WORKING_BYTES,
    ContractError,
    ValidatedRequest,
    basis_point_to_pixel,
    box_basis_to_pixels,
)

REPOSITORY_URL = "https://github.com/facebookresearch/sam2"
REPOSITORY_COMMIT = "05d9e57fb3945b10c861046c1e6749e2bfc258e3"
MODEL_ID = "sam2.1_hiera_base_plus"
CONFIG_IDENTITY = "configs/sam2.1/sam2.1_hiera_b+.yaml"
CHECKPOINT_URL = (
    "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt"
)
MANIFEST_PATH = IMAGE_MANIFEST_PATH
SOURCE_ROOT = IMAGE_SOURCE_ROOT
CONFIG_PATH = IMAGE_CONFIG_PATH
CHECKPOINT_PATH = IMAGE_CHECKPOINT_PATH
LICENSE_ROOT = IMAGE_LICENSE_ROOT

AUTOMATIC_MULTIMASK_OUTPUTS = 3
AUTOMATIC_LOW_RESOLUTION_SIDE = 256
AUTOMATIC_BATCH_WORKING_BYTES = 268_435_456
MAX_AUTOMATIC_RETAINED_RLE_RUNS = 8_000_000
AUTOMATIC_COMPACT_RLE_RUN_BYTES = 4
AUTOMATIC_RETAINED_METADATA_BYTES = 8_388_608
AUTOMATIC_ENCODER_BYTES_PER_MASK_PIXEL = {
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
}
AUTOMATIC_ENCODER_BYTES_PER_MASK_PIXEL_TOTAL = sum(
    AUTOMATIC_ENCODER_BYTES_PER_MASK_PIXEL.values()
)
AUTOMATIC_RETAINED_COMPACT_RLE_BYTES = (
    MAX_AUTOMATIC_RETAINED_RLE_RUNS * AUTOMATIC_COMPACT_RLE_RUN_BYTES
)
AUTOMATIC_BATCH_FIXED_RESERVE_BYTES = (
    AUTOMATIC_RETAINED_COMPACT_RLE_BYTES + AUTOMATIC_RETAINED_METADATA_BYTES
)

AUTOMATIC_GENERATOR_PROFILE = {
    "points_per_side": 32,
    "points_per_batch": 64,
    "pred_iou_thresh": 0.8,
    "stability_score_thresh": 0.95,
    "stability_score_offset": 1.0,
    "mask_threshold": 0.0,
    "box_nms_thresh": 0.7,
    "crop_n_layers": 0,
    "crop_nms_thresh": 0.7,
    "crop_overlap_ratio": 512 / 1500,
    "crop_n_points_downscale_factor": 1,
    "point_grids": None,
    "min_mask_region_area": 0,
    "output_mode": "uncompressed_rle",
    "use_m2m": False,
    "multimask_output": True,
}


def _validate_automatic_dimensions(width: int, height: int) -> int:
    if (
        isinstance(width, bool)
        or isinstance(height, bool)
        or not isinstance(width, int)
        or not isinstance(height, int)
        or width < 1
        or height < 1
    ):
        raise ContractError("automatic batch dimensions are invalid")
    return width * height


def automatic_batch_peak_bytes(
    width: int, height: int, points_per_batch: int
) -> int:
    """Conservative pooled peak for the pinned three-mask automatic batch path."""

    pixels = _validate_automatic_dimensions(width, height)
    if (
        isinstance(points_per_batch, bool)
        or not isinstance(points_per_batch, int)
        or points_per_batch < 0
        or points_per_batch > int(AUTOMATIC_GENERATOR_PROFILE["points_per_batch"])
    ):
        raise ContractError("automatic point batch count is invalid")
    low_resolution_bytes_per_mask = (
        AUTOMATIC_LOW_RESOLUTION_SIDE * AUTOMATIC_LOW_RESOLUTION_SIDE * 4
    )
    bytes_per_mask = (
        pixels * AUTOMATIC_ENCODER_BYTES_PER_MASK_PIXEL_TOTAL
        + low_resolution_bytes_per_mask
    )
    return AUTOMATIC_BATCH_FIXED_RESERVE_BYTES + (
        points_per_batch * AUTOMATIC_MULTIMASK_OUTPUTS * bytes_per_mask
    )


def automatic_points_per_batch(width: int, height: int) -> int:
    """Return a conservative source-dependent batch size or refuse before inference."""

    _validate_automatic_dimensions(width, height)
    fixed_peak = automatic_batch_peak_bytes(width, height, 0)
    one_point_peak = automatic_batch_peak_bytes(width, height, 1)
    if one_point_peak > AUTOMATIC_BATCH_WORKING_BYTES:
        raise ContractError(
            "ENGINE_OUTPUT_LIMIT: automatic source cannot fit one worst-case batch"
        )
    bytes_per_point = one_point_peak - fixed_peak
    return min(
        int(AUTOMATIC_GENERATOR_PROFILE["points_per_batch"]),
        (AUTOMATIC_BATCH_WORKING_BYTES - fixed_peak) // bytes_per_point,
    )


class AutomaticBatchBudget:
    """Cumulative automatic-path budget shared by every official point batch."""

    def __init__(
        self,
        source_pixels: int,
        maximum_candidates: int = MAX_RAW_CANDIDATES,
        maximum_rle_runs: int = MAX_AUTOMATIC_RETAINED_RLE_RUNS,
    ) -> None:
        self.source_pixels = source_pixels
        self.maximum_candidates = maximum_candidates
        self.maximum_rle_runs = maximum_rle_runs
        self.retained_candidates = 0
        self.retained_rle_runs = 0
        self._pending_run_counts: Tuple[int, ...] | None = None

    def reserve_rle_runs(
        self, transition_counts: Sequence[Any], starts_with_one: Sequence[Any]
    ) -> Tuple[int, ...]:
        if self._pending_run_counts is not None:
            raise ContractError("automatic RLE reservation was not consumed")
        if len(transition_counts) != len(starts_with_one):
            raise ContractError("automatic RLE transition metadata drifted")
        run_counts: List[int] = []
        for transitions, starts in zip(transition_counts, starts_with_one):
            if (
                isinstance(transitions, bool)
                or not isinstance(transitions, int)
                or transitions < 0
                or transitions >= self.source_pixels
                or not isinstance(starts, bool)
            ):
                raise ContractError("automatic RLE transition metadata is invalid")
            run_counts.append(transitions + 1 + (1 if starts else 0))
        reserved = sum(run_counts)
        if self.retained_rle_runs + reserved > self.maximum_rle_runs:
            raise ContractError(
                "ENGINE_OUTPUT_LIMIT: automatic retained RLE run budget exceeded"
            )
        self.retained_rle_runs += reserved
        self._pending_run_counts = tuple(run_counts)
        return self._pending_run_counts

    def consume_run_counts(self) -> Tuple[int, ...]:
        if self._pending_run_counts is None:
            raise ContractError("automatic batch omitted its RLE reservation")
        result = self._pending_run_counts
        self._pending_run_counts = None
        return result

    def retain_candidates(self, count: int) -> None:
        if (
            isinstance(count, bool)
            or not isinstance(count, int)
            or count < 0
            or self.retained_candidates + count > self.maximum_candidates
        ):
            raise ContractError(
                "ENGINE_OUTPUT_LIMIT: raw candidate count exceeds 512"
            )
        self.retained_candidates += count


def materialize_guarded_automatic_rles(
    budget: AutomaticBatchBudget,
    transition_counts: Sequence[Any],
    starts_with_one: Sequence[Any],
    materialize: Callable[[], Any],
) -> Any:
    """Refuse the run budget before invoking the official Python-list encoder."""

    budget.reserve_rle_runs(transition_counts, starts_with_one)
    return materialize()


def compact_official_automatic_batch(
    batch_data: Any,
    width: int,
    height: int,
    budget: AutomaticBatchBudget,
) -> Any:
    """Strictly validate and compact one pinned `_process_batch` result."""

    try:
        fields = dict(batch_data.items())
    except (AttributeError, TypeError, ValueError) as error:
        raise ContractError("automatic batch data shape drifted") from error
    expected_fields = {
        "rles",
        "boxes",
        "iou_preds",
        "points",
        "low_res_masks",
        "stability_score",
    }
    if set(fields) != expected_fields or not isinstance(fields["rles"], list):
        raise ContractError("automatic batch data shape drifted")
    rles = fields["rles"]
    candidate_count = len(rles)
    for field in expected_fields - {"rles"}:
        try:
            if len(fields[field]) != candidate_count:
                raise ContractError("automatic batch field lengths drifted")
        except TypeError as error:
            raise ContractError("automatic batch field lengths drifted") from error
    expected_run_counts = budget.consume_run_counts()
    if len(expected_run_counts) != candidate_count:
        raise ContractError("automatic batch RLE count drifted")
    budget.retain_candidates(candidate_count)

    for index, rle in enumerate(rles):
        if not isinstance(rle, dict) or set(rle) != {"size", "counts"}:
            raise ContractError("automatic batch RLE shape drifted")
        counts = rle["counts"]
        if (
            rle["size"] != [height, width]
            or not isinstance(counts, list)
            or len(counts) != expected_run_counts[index]
        ):
            raise ContractError("automatic batch RLE dimensions drifted")
        total = 0
        for count_index, count in enumerate(counts):
            if (
                isinstance(count, bool)
                or not isinstance(count, int)
                or count < 0
                or (count == 0 and count_index != 0)
            ):
                raise ContractError("automatic batch RLE run is invalid")
            total += count
            if total > budget.source_pixels:
                raise ContractError("automatic batch RLE exceeds source pixels")
        if total != budget.source_pixels:
            raise ContractError("automatic batch RLE pixel sum drifted")
        compact_counts = array("I", counts)
        if compact_counts.itemsize != AUTOMATIC_COMPACT_RLE_RUN_BYTES:
            raise ContractError("automatic compact RLE integer width drifted")
        rle["counts"] = compact_counts

    # `use_m2m=False` makes these logits dead after the pinned batch returns.
    # Deleting them here prevents Meta's crop accumulator from retaining them.
    del batch_data["low_res_masks"]
    return batch_data


def materialize_compact_automatic_candidates(
    generated: Sequence[Mapping[str, Any]],
    width: int,
    height: int,
    decode_rle: Any,
) -> List[Mapping[str, Any]]:
    """Validate every compact official RLE before decoding any HxW binary mask."""

    pixel_count = width * height
    if len(generated) > MAX_RAW_CANDIDATES:
        raise ContractError("ENGINE_OUTPUT_LIMIT: raw candidate count exceeds 512")
    if len(generated) * pixel_count > MAX_RAW_MASK_WORKING_BYTES:
        raise ContractError(
            "ENGINE_OUTPUT_LIMIT: aggregate raw mask working bytes exceed 256 MiB"
        )
    validated: List[Mapping[str, Any]] = []
    exact_keys = {
        "segmentation",
        "area",
        "bbox",
        "predicted_iou",
        "point_coords",
        "stability_score",
        "crop_box",
    }
    for candidate in generated:
        if not isinstance(candidate, dict) or set(candidate) != exact_keys:
            raise ContractError("automatic generator candidate shape drifted")
        segmentation = candidate["segmentation"]
        if not isinstance(segmentation, dict) or set(segmentation) != {"size", "counts"}:
            raise ContractError("automatic generator compact RLE shape drifted")
        size = segmentation["size"]
        counts = segmentation["counts"]
        if (
            not isinstance(size, list)
            or size != [height, width]
            or not isinstance(counts, (list, array))
            or not counts
            or len(counts) > pixel_count + 1
        ):
            raise ContractError("automatic generator compact RLE dimensions drifted")
        total = 0
        for index, count in enumerate(counts):
            if (
                isinstance(count, bool)
                or not isinstance(count, int)
                or count < 0
                or (count == 0 and index != 0)
            ):
                raise ContractError("automatic generator compact RLE run is invalid")
            total += count
            if total > pixel_count:
                raise ContractError("automatic generator compact RLE exceeds source pixels")
        if total != pixel_count:
            raise ContractError("automatic generator compact RLE pixel sum drifted")
        for field in ("predicted_iou", "stability_score"):
            score = candidate[field]
            if (
                isinstance(score, bool)
                or not isinstance(score, (int, float))
                or not math.isfinite(float(score))
                or float(score) < 0
                or float(score) > 1
            ):
                raise ContractError("automatic generator score is invalid")
        validated.append(candidate)

    materialized: List[Mapping[str, Any]] = []
    for candidate in validated:
        decoded = decode_rle(candidate["segmentation"])
        if (
            not isinstance(decoded, (bytes, bytearray))
            or len(decoded) != pixel_count
            or any(value not in (0, 1) for value in decoded)
        ):
            raise ContractError("automatic generator decoded mask drifted")
        materialized.append(
            {
                "mask": bytes(decoded),
                "predictedIou": float(candidate["predicted_iou"]),
                "stabilityScore": float(candidate["stability_score"]),
            }
        )
    return materialized


def validate_model_artifacts(
    verify_digests: bool = True,
) -> Mapping[str, Any]:
    if verify_digests:
        return verify_runtime_artifacts(
            manifest_path=MANIFEST_PATH,
            source_root=SOURCE_ROOT,
            checkpoint_path=CHECKPOINT_PATH,
            licenses_root=LICENSE_ROOT,
        )
    return preflight_runtime_artifacts(
        manifest_path=MANIFEST_PATH,
        source_root=SOURCE_ROOT,
        checkpoint_path=CHECKPOINT_PATH,
        licenses_root=LICENSE_ROOT,
    )


def load_reviewed_checkpoint(
    torch_module: Any,
    model: Any,
) -> None:
    """Load only the reviewed state-dict shape after full artifact verification."""

    payload = None
    state = None
    incompatible = None
    try:
        payload = torch_module.load(
            str(CHECKPOINT_PATH),
            map_location="cpu",
            weights_only=True,
        )
        if not isinstance(payload, dict) or set(payload) != {"model"}:
            raise RuntimeError(
                "Reviewed checkpoint top-level state shape drifted."
            )
        state = payload["model"]
        if (
            not isinstance(state, Mapping)
            or not state
            or any(
                not isinstance(key, str) or not key
                for key in state
            )
        ):
            raise RuntimeError("Reviewed checkpoint model state is invalid.")
        incompatible = model.load_state_dict(state, strict=False)
        missing = getattr(incompatible, "missing_keys", None)
        unexpected = getattr(incompatible, "unexpected_keys", None)
        if (
            not isinstance(missing, (list, tuple))
            or not isinstance(unexpected, (list, tuple))
            or any(not isinstance(key, str) for key in missing)
            or any(not isinstance(key, str) for key in unexpected)
        ):
            raise RuntimeError(
                "Reviewed checkpoint load result shape drifted."
            )
        if missing or unexpected:
            raise RuntimeError(
                "Reviewed checkpoint keys do not exactly match the model."
            )
    finally:
        incompatible = None
        state = None
        payload = None
        gc.collect()


class ProductionSamEngine:
    """Loads one verified warm model and serializes GPU/CPU inference requests."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._loaded = False
        self._manifest: Mapping[str, Any] = {}
        self._torch: Any = None
        self._numpy: Any = None
        self._model: Any = None
        self._predictor: Any = None
        self._automatic_generator: Any = None
        self._automatic_generator_module: Any = None
        self._official_process_batch: Any = None
        self._official_mask_to_rle_pytorch: Any = None
        self._official_rle_to_mask: Any = None
        self._device = "cpu"

    def load(self) -> None:
        if self._loaded:
            return
        with self._lock:
            if self._loaded:
                return
            self._manifest = validate_model_artifacts()
            # Artifact validation intentionally happens before importing torch or SAM.
            model = None
            torch = None
            try:
                import numpy
                import torch
                import sam2.automatic_mask_generator as automatic_generator_module
                from sam2.automatic_mask_generator import (
                    SAM2AutomaticMaskGenerator,
                )
                from sam2.build_sam import build_sam2
                from sam2.utils.amg import rle_to_mask

                self._device = (
                    "cuda" if torch.cuda.is_available() else "cpu"
                )
                model = build_sam2(
                    CONFIG_IDENTITY,
                    ckpt_path=None,
                    device=self._device,
                    mode="eval",
                )
                load_reviewed_checkpoint(torch, model)
                automatic_generator = SAM2AutomaticMaskGenerator(
                    model, **AUTOMATIC_GENERATOR_PROFILE
                )
                predictor = getattr(automatic_generator, "predictor", None)
                if predictor is None:
                    raise RuntimeError(
                        "Pinned automatic generator predictor is unavailable."
                    )
                self._torch = torch
                self._numpy = numpy
                self._model = model
                self._automatic_generator = automatic_generator
                self._automatic_generator_module = (
                    automatic_generator_module
                )
                self._official_process_batch = (
                    SAM2AutomaticMaskGenerator._process_batch
                )
                self._official_mask_to_rle_pytorch = (
                    automatic_generator_module.mask_to_rle_pytorch
                )
                self._predictor = predictor
                self._official_rle_to_mask = rle_to_mask
                self._loaded = True
            except Exception:
                model = None
                self._model = None
                self._automatic_generator = None
                self._predictor = None
                gc.collect()
                if (
                    torch is not None
                    and self._device == "cuda"
                    and torch.cuda.is_available()
                ):
                    torch.cuda.empty_cache()
                raise

    def execution_identity(self) -> Dict[str, str]:
        if not self._loaded:
            raise RuntimeError("SAM engine identity is unavailable before verified load.")
        return {
            "kind": "meta-sam2.1",
            "repositoryUrl": REPOSITORY_URL,
            "repositoryCommit": REPOSITORY_COMMIT,
            "modelId": MODEL_ID,
            "configIdentity": CONFIG_IDENTITY,
            "checkpointUrl": CHECKPOINT_URL,
            "checkpointSha256": self._manifest["checkpoint"]["sha256"],
        }

    def _stability(self, logits: Any) -> float:
        intersection = int((logits > 1.0).sum())
        union = int((logits > -1.0).sum())
        return 0.0 if union == 0 else intersection / union

    def _prompt_candidates(self, validated: ValidatedRequest) -> Sequence[Mapping[str, Any]]:
        request = validated.request
        width = request["source"]["width"]
        height = request["source"]["height"]
        image = self._numpy.frombuffer(validated.rgba_bytes, dtype=self._numpy.uint8).reshape(
            height, width, 4
        )[:, :, :3]
        self._predictor.set_image(image)
        segmentation = request["segmentation"]
        prompt = segmentation["prompt"]
        if segmentation["mode"] == "point-prompt":
            coordinates = self._numpy.array(
                [
                    [
                        basis_point_to_pixel(point["xBps"], width),
                        basis_point_to_pixel(point["yBps"], height),
                    ]
                    for point in prompt["points"]
                ],
                dtype=self._numpy.float32,
            )
            labels = self._numpy.array(
                [1 if point["polarity"] == "positive" else 0 for point in prompt["points"]],
                dtype=self._numpy.int32,
            )
            masks, scores, logits = self._predictor.predict(
                point_coords=coordinates,
                point_labels=labels,
                multimask_output=True,
                return_logits=True,
                normalize_coords=True,
            )
        else:
            box = box_basis_to_pixels(prompt["box"], width, height)
            coordinates = self._numpy.array(
                [box["left"], box["top"], box["rightInclusive"], box["bottomInclusive"]],
                dtype=self._numpy.float32,
            )
            masks, scores, logits = self._predictor.predict(
                box=coordinates,
                multimask_output=True,
                return_logits=True,
                normalize_coords=True,
            )
        return [
            {
                "mask": bytes(self._numpy.asarray(mask > 0.0, dtype=self._numpy.uint8).reshape(-1)),
                "predictedIou": float(score),
                "stabilityScore": self._stability(logit),
            }
            for mask, score, logit in zip(masks, scores, logits)
        ]

    def _automatic_candidates(
        self, image: Any, width: int, height: int
    ) -> Sequence[Mapping[str, Any]]:
        batch_size = automatic_points_per_batch(width, height)
        generator = self._automatic_generator
        module = self._automatic_generator_module
        if (
            module.mask_to_rle_pytorch is not self._official_mask_to_rle_pytorch
            or type(generator)._process_batch is not self._official_process_batch
            or "_process_batch" in vars(generator)
            or generator.points_per_batch
            != AUTOMATIC_GENERATOR_PROFILE["points_per_batch"]
        ):
            raise RuntimeError("Pinned automatic batch path identity drifted.")
        budget = AutomaticBatchBudget(width * height)
        original_points_per_batch = generator.points_per_batch

        def guarded_rle_materialization(masks: Any) -> Any:
            shape = tuple(masks.shape)
            if (
                len(shape) != 3
                or shape[0] > batch_size * AUTOMATIC_MULTIMASK_OUTPUTS
                or shape[1:] != (height, width)
            ):
                raise ContractError("automatic RLE tensor shape drifted")
            flattened = masks.permute(0, 2, 1).flatten(1)
            transitions = flattened[:, 1:] != flattened[:, :-1]
            transition_counts = (
                transitions.sum(dim=1).detach().cpu().tolist()
            )
            starts_with_one = flattened[:, 0].detach().cpu().tolist()
            transitions = None
            flattened = None
            return materialize_guarded_automatic_rles(
                budget,
                transition_counts,
                starts_with_one,
                lambda: self._official_mask_to_rle_pytorch(masks),
            )

        def guarded_process_batch(
            points: Any,
            im_size: Any,
            crop_box: Any,
            orig_size: Any,
            normalize: bool = False,
        ) -> Any:
            if (
                len(points) > batch_size
                or tuple(im_size) != (height, width)
                or list(crop_box) != [0, 0, width, height]
                or tuple(orig_size) != (height, width)
                or normalize is not True
            ):
                raise ContractError("automatic batch invocation drifted")
            batch_data = self._official_process_batch(
                generator,
                points,
                im_size,
                crop_box,
                orig_size,
                normalize=normalize,
            )
            return compact_official_automatic_batch(
                batch_data, width, height, budget
            )

        module.mask_to_rle_pytorch = guarded_rle_materialization
        generator._process_batch = guarded_process_batch
        generator.points_per_batch = batch_size
        try:
            return generator.generate(image)
        finally:
            module.mask_to_rle_pytorch = self._official_mask_to_rle_pytorch
            generator.points_per_batch = original_points_per_batch
            if "_process_batch" in vars(generator):
                delattr(generator, "_process_batch")

    def segment(self, validated: ValidatedRequest) -> Sequence[Mapping[str, Any]]:
        self.load()
        with self._lock:
            image = None
            generated = None
            materialized = None
            try:
                image = self._numpy.frombuffer(
                    validated.rgba_bytes, dtype=self._numpy.uint8
                ).reshape(
                    validated.request["source"]["height"],
                    validated.request["source"]["width"],
                    4,
                )[:, :, :3]
                with self._torch.inference_mode():
                    autocast = (
                        self._torch.autocast("cuda", dtype=self._torch.bfloat16)
                        if self._device == "cuda"
                        else _NullContext()
                    )
                    with autocast:
                        if validated.request["segmentation"]["mode"] == "automatic-candidates":
                            generated = self._automatic_candidates(
                                image,
                                validated.request["source"]["width"],
                                validated.request["source"]["height"],
                            )
                            materialized = materialize_compact_automatic_candidates(
                                generated,
                                validated.request["source"]["width"],
                                validated.request["source"]["height"],
                                lambda rle: bytes(
                                    self._numpy.asarray(
                                        self._official_rle_to_mask(rle),
                                        dtype=self._numpy.uint8,
                                    ).reshape(-1)
                                ),
                            )
                            return materialized
                        return self._prompt_candidates(validated)
            finally:
                image = None
                generated = None
                materialized = None
                self._cleanup_request_state()

    def _cleanup_request_state(self) -> None:
        try:
            if self._predictor is not None and hasattr(self._predictor, "reset_predictor"):
                self._predictor.reset_predictor()
        finally:
            gc.collect()
            if self._device == "cuda" and self._torch is not None:
                self._torch.cuda.empty_cache()


class _NullContext:
    def __enter__(self) -> "_NullContext":
        return self

    def __exit__(self, _exception_type: Any, _exception: Any, _traceback: Any) -> None:
        return None
