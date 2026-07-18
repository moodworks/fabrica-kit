"""Artifact-only probe; it never loads a second SAM model."""

import sys
from .engine import validate_model_artifacts


def main() -> None:
    validate_model_artifacts(verify_digests="--light" not in sys.argv)
    print("sam-worker-artifacts-ok")


if __name__ == "__main__":
    main()
