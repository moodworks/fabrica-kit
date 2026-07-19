"""Closed package overlay for the one reviewed SAM configuration.

The upstream package initializer is retained byte-for-byte in sam2-source. It is not
executed because it exists only to initialize Hydra, which has no wheel-only closure.
This overlay exposes exactly the verified upstream package directory and no ambient
namespace or fallback path.
"""

from pathlib import Path

_OVERLAY_ROOT = Path(__file__).resolve(strict=True).parents[1]
_SOURCE_PACKAGE = (_OVERLAY_ROOT.parent / "sam2-source" / "sam2").resolve(
    strict=True
)
if (
    not _SOURCE_PACKAGE.is_dir()
    or _SOURCE_PACKAGE.is_symlink()
    or _SOURCE_PACKAGE.parent != _OVERLAY_ROOT.parent / "sam2-source"
):
    raise RuntimeError("Reviewed SAM package overlay is unavailable.")

__path__ = [str(_SOURCE_PACKAGE)]
if __spec__ is None or __spec__.submodule_search_locations is None:
    raise RuntimeError("Reviewed SAM package overlay is invalid.")
__spec__.submodule_search_locations[:] = __path__

