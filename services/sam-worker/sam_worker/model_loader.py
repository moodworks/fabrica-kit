"""Selected-config-only SAM constructor without Hydra or ambient package paths."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from typing import Any, Dict, Mapping, Sequence, Tuple

from .artifacts import IMAGE_CONFIG_PATH, IMAGE_SOURCE_ROOT

OVERLAY_ROOT = Path("/opt/fabrica/sam2-overlay")
PARSED_CONFIG_SHA256 = (
    "4c9b2a847cc3672fdc80cddf09bb5b4128e3b35d5ebbc732e3b1142d5de5f080"
)
TARGET_INVENTORY: Tuple[Tuple[str, str], ...] = (
    ("model", "sam2.modeling.sam2_base.SAM2Base"),
    (
        "model.image_encoder",
        "sam2.modeling.backbones.image_encoder.ImageEncoder",
    ),
    (
        "model.image_encoder.trunk",
        "sam2.modeling.backbones.hieradet.Hiera",
    ),
    (
        "model.image_encoder.neck",
        "sam2.modeling.backbones.image_encoder.FpnNeck",
    ),
    (
        "model.image_encoder.neck.position_encoding",
        "sam2.modeling.position_encoding.PositionEmbeddingSine",
    ),
    (
        "model.memory_attention",
        "sam2.modeling.memory_attention.MemoryAttention",
    ),
    (
        "model.memory_attention.layer",
        "sam2.modeling.memory_attention.MemoryAttentionLayer",
    ),
    (
        "model.memory_attention.layer.self_attention",
        "sam2.modeling.sam.transformer.RoPEAttention",
    ),
    (
        "model.memory_attention.layer.cross_attention",
        "sam2.modeling.sam.transformer.RoPEAttention",
    ),
    (
        "model.memory_encoder",
        "sam2.modeling.memory_encoder.MemoryEncoder",
    ),
    (
        "model.memory_encoder.position_encoding",
        "sam2.modeling.position_encoding.PositionEmbeddingSine",
    ),
    (
        "model.memory_encoder.mask_downsampler",
        "sam2.modeling.memory_encoder.MaskDownSampler",
    ),
    (
        "model.memory_encoder.fuser",
        "sam2.modeling.memory_encoder.Fuser",
    ),
    (
        "model.memory_encoder.fuser.layer",
        "sam2.modeling.memory_encoder.CXBlock",
    ),
)
ALLOWED_TARGETS = frozenset(target for _path, target in TARGET_INVENTORY)
POSTPROCESSING_OVERRIDES = {
    "dynamic_multimask_stability_delta": 0.05,
    "dynamic_multimask_stability_thresh": 0.98,
    "dynamic_multimask_via_stability": True,
}


class ModelConfigError(RuntimeError):
    """Redacted selected-config construction failure."""


def _canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
        allow_nan=False,
    )


def _walk_config(
    value: Any,
    path: str,
    targets: list[Tuple[str, str]],
) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if not isinstance(key, str) or not key or key == "weights_path":
                raise ModelConfigError("Reviewed model configuration is invalid.")
            child_path = key if not path else path + "." + key
            if key == "_target_":
                if (
                    not isinstance(child, str)
                    or child not in ALLOWED_TARGETS
                    or path == ""
                ):
                    raise ModelConfigError(
                        "Reviewed model target inventory drifted."
                    )
                targets.append((path, child))
            else:
                _walk_config(child, child_path, targets)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _walk_config(child, "%s[%d]" % (path, index), targets)
    elif isinstance(value, str):
        if "${" in value or "\x00" in value:
            raise ModelConfigError("Reviewed model configuration is invalid.")
    elif value is not None and not isinstance(value, (bool, int, float)):
        raise ModelConfigError("Reviewed model configuration is invalid.")


def parse_reviewed_config(data: bytes, yaml_module: Any) -> Mapping[str, Any]:
    """Parse only the exact reviewed YAML while rejecting YAML graph features."""

    try:
        text = data.decode("utf-8", errors="strict")
        tokens = tuple(yaml_module.scan(text))
    except (UnicodeError, ValueError, yaml_module.YAMLError) as error:
        raise ModelConfigError("Reviewed model configuration is invalid.") from error
    forbidden_tokens = {
        "AliasToken",
        "AnchorToken",
        "DirectiveToken",
        "TagToken",
    }
    if any(type(token).__name__ in forbidden_tokens for token in tokens):
        raise ModelConfigError("Reviewed model configuration is invalid.")

    class UniqueKeySafeLoader(yaml_module.SafeLoader):
        pass

    def construct_mapping(loader: Any, node: Any, deep: bool = False) -> Dict[str, Any]:
        if node.tag != yaml_module.resolver.BaseResolver.DEFAULT_MAPPING_TAG:
            raise ModelConfigError("Reviewed model configuration is invalid.")
        result: Dict[str, Any] = {}
        for key_node, value_node in node.value:
            if (
                key_node.tag == "tag:yaml.org,2002:merge"
                or getattr(key_node, "value", None) == "<<"
            ):
                raise ModelConfigError("Reviewed model configuration is invalid.")
            key = loader.construct_object(key_node, deep=deep)
            if not isinstance(key, str) or key in result or key == "<<":
                raise ModelConfigError("Reviewed model configuration is invalid.")
            result[key] = loader.construct_object(value_node, deep=deep)
        return result

    UniqueKeySafeLoader.add_constructor(
        yaml_module.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
        construct_mapping,
    )
    try:
        loader = UniqueKeySafeLoader(text)
        try:
            value = loader.get_single_data()
        finally:
            loader.dispose()
    except (ModelConfigError, ValueError, yaml_module.YAMLError) as error:
        if isinstance(error, ModelConfigError):
            raise
        raise ModelConfigError("Reviewed model configuration is invalid.") from error
    try:
        parsed_digest = hashlib.sha256(
            _canonical_json(value).encode("utf-8")
        ).hexdigest()
    except (TypeError, ValueError) as error:
        raise ModelConfigError("Reviewed model configuration is invalid.") from error
    targets: list[Tuple[str, str]] = []
    _walk_config(value, "", targets)
    if (
        not isinstance(value, dict)
        or set(value) != {"model"}
        or parsed_digest != PARSED_CONFIG_SHA256
        or tuple(targets) != TARGET_INVENTORY
    ):
        raise ModelConfigError("Reviewed model configuration drifted.")
    return value


def _instantiate(
    value: Any,
    path: str,
    constructors: Mapping[Tuple[str, str], Any],
) -> Any:
    if isinstance(value, list):
        return [
            _instantiate(child, "%s[%d]" % (path, index), constructors)
            for index, child in enumerate(value)
        ]
    if not isinstance(value, dict):
        return value
    target = value.get("_target_")
    if target is None:
        return {
            key: _instantiate(child, path + "." + key, constructors)
            for key, child in value.items()
        }
    if (path, target) not in TARGET_INVENTORY or set(value) & {
        "_args_",
        "_convert_",
        "_partial_",
        "_recursive_",
    }:
        raise ModelConfigError("Reviewed model target inventory drifted.")
    constructor = constructors.get((path, target))
    if not callable(constructor):
        raise ModelConfigError("Reviewed model target is unavailable.")
    kwargs = {
        key: _instantiate(child, path + "." + key, constructors)
        for key, child in value.items()
        if key != "_target_"
    }
    return constructor(**kwargs)


def instantiate_reviewed_config(
    config: Mapping[str, Any],
    constructors: Mapping[Tuple[str, str], Any],
) -> Any:
    if set(constructors) != set(TARGET_INVENTORY):
        raise ModelConfigError("Reviewed model constructor inventory drifted.")
    model_config = dict(config["model"])
    if "sam_mask_decoder_extra_args" in model_config:
        raise ModelConfigError("Reviewed postprocessing overrides drifted.")
    model_config["sam_mask_decoder_extra_args"] = dict(
        POSTPROCESSING_OVERRIDES
    )
    return _instantiate(model_config, "model", constructors)


def _verify_overlay_origin(package: Any, source_package: Path) -> None:
    expected_origin = (OVERLAY_ROOT / "sam2/__init__.py").resolve(strict=True)
    origin = Path(getattr(package, "__file__", "")).resolve(strict=True)
    package_path = tuple(Path(value).resolve(strict=True) for value in package.__path__)
    if origin != expected_origin or package_path != (source_package,):
        raise ModelConfigError("Reviewed SAM package overlay drifted.")


def _verify_iopath_overlay_origins(
    package: Any,
    common_package: Any,
    file_io_module: Any,
) -> None:
    expected = {
        package: OVERLAY_ROOT / "iopath/__init__.py",
        common_package: OVERLAY_ROOT / "iopath/common/__init__.py",
        file_io_module: OVERLAY_ROOT / "iopath/common/file_io.py",
    }
    for module, expected_path in expected.items():
        try:
            origin = Path(getattr(module, "__file__", "")).resolve(strict=True)
            expected_origin = expected_path.resolve(strict=True)
        except OSError as error:
            raise ModelConfigError(
                "Reviewed iopath refusal overlay drifted."
            ) from error
        if origin != expected_origin:
            raise ModelConfigError("Reviewed iopath refusal overlay drifted.")
    package_path = tuple(
        Path(value).resolve(strict=True) for value in package.__path__
    )
    common_path = tuple(
        Path(value).resolve(strict=True) for value in common_package.__path__
    )
    if package_path != ((OVERLAY_ROOT / "iopath").resolve(strict=True),) or common_path != (
        (OVERLAY_ROOT / "iopath/common").resolve(strict=True),
    ):
        raise ModelConfigError("Reviewed iopath refusal overlay drifted.")


def _verify_constructor_origins(
    constructors: Mapping[Tuple[str, str], Any],
    source_package: Path,
) -> None:
    for constructor in constructors.values():
        module = sys.modules.get(getattr(constructor, "__module__", ""))
        module_file = getattr(module, "__file__", None)
        if not isinstance(module_file, str):
            raise ModelConfigError("Reviewed model target origin is invalid.")
        try:
            Path(module_file).resolve(strict=True).relative_to(source_package)
        except (OSError, ValueError) as error:
            raise ModelConfigError(
                "Reviewed model target origin is invalid."
            ) from error


def build_reviewed_model(device: str) -> Any:
    """Reproduce the selected build_sam2 defaults for one exact config graph."""

    try:
        config_data = IMAGE_CONFIG_PATH.read_bytes()
        if (
            len(config_data) != 3650
            or hashlib.sha256(config_data).hexdigest()
            != "e73f9e9547b305040552ee943ebd3a34cee5727a76fc2ab88b87f7b28b430754"
        ):
            raise ModelConfigError("Reviewed model configuration drifted.")
        import yaml

        config = parse_reviewed_config(config_data, yaml)
        source_package = (IMAGE_SOURCE_ROOT / "sam2").resolve(strict=True)
        import iopath
        import iopath.common
        import iopath.common.file_io
        import sam2
        from sam2.modeling.backbones.hieradet import Hiera
        from sam2.modeling.backbones.image_encoder import FpnNeck, ImageEncoder
        from sam2.modeling.memory_attention import (
            MemoryAttention,
            MemoryAttentionLayer,
        )
        from sam2.modeling.memory_encoder import (
            CXBlock,
            Fuser,
            MaskDownSampler,
            MemoryEncoder,
        )
        from sam2.modeling.position_encoding import PositionEmbeddingSine
        from sam2.modeling.sam.transformer import RoPEAttention
        from sam2.modeling.sam2_base import SAM2Base

        _verify_overlay_origin(sam2, source_package)
        _verify_iopath_overlay_origins(
            iopath,
            iopath.common,
            iopath.common.file_io,
        )
        constructors = {
            (
                "model",
                "sam2.modeling.sam2_base.SAM2Base",
            ): SAM2Base,
            (
                "model.image_encoder",
                "sam2.modeling.backbones.image_encoder.ImageEncoder",
            ): ImageEncoder,
            (
                "model.image_encoder.trunk",
                "sam2.modeling.backbones.hieradet.Hiera",
            ): Hiera,
            (
                "model.image_encoder.neck",
                "sam2.modeling.backbones.image_encoder.FpnNeck",
            ): FpnNeck,
            (
                "model.image_encoder.neck.position_encoding",
                "sam2.modeling.position_encoding.PositionEmbeddingSine",
            ): PositionEmbeddingSine,
            (
                "model.memory_attention",
                "sam2.modeling.memory_attention.MemoryAttention",
            ): MemoryAttention,
            (
                "model.memory_attention.layer",
                "sam2.modeling.memory_attention.MemoryAttentionLayer",
            ): MemoryAttentionLayer,
            (
                "model.memory_attention.layer.self_attention",
                "sam2.modeling.sam.transformer.RoPEAttention",
            ): RoPEAttention,
            (
                "model.memory_attention.layer.cross_attention",
                "sam2.modeling.sam.transformer.RoPEAttention",
            ): RoPEAttention,
            (
                "model.memory_encoder",
                "sam2.modeling.memory_encoder.MemoryEncoder",
            ): MemoryEncoder,
            (
                "model.memory_encoder.position_encoding",
                "sam2.modeling.position_encoding.PositionEmbeddingSine",
            ): PositionEmbeddingSine,
            (
                "model.memory_encoder.mask_downsampler",
                "sam2.modeling.memory_encoder.MaskDownSampler",
            ): MaskDownSampler,
            (
                "model.memory_encoder.fuser",
                "sam2.modeling.memory_encoder.Fuser",
            ): Fuser,
            (
                "model.memory_encoder.fuser.layer",
                "sam2.modeling.memory_encoder.CXBlock",
            ): CXBlock,
        }
        _verify_constructor_origins(constructors, source_package)
        model = instantiate_reviewed_config(config, constructors)
        model = model.to(device)
        model.eval()
        return model
    except ModelConfigError:
        raise
    except Exception as error:
        raise ModelConfigError("Reviewed model construction failed.") from error
