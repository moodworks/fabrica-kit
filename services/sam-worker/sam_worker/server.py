"""Pinned single-process Uvicorn launcher for the direct HTTP worker."""

from __future__ import annotations

import os


def validated_port() -> int:
    raw_port = os.environ.get("PORT", "80")
    if (
        not raw_port.isascii()
        or not raw_port.isdigit()
        or (len(raw_port) > 1 and raw_port[0] == "0")
    ):
        raise RuntimeError("SAM worker port configuration is invalid.")
    port = int(raw_port)
    if port < 1 or port > 65_535:
        raise RuntimeError("SAM worker port configuration is invalid.")
    health_port = os.environ.get("PORT_HEALTH")
    if health_port is not None and health_port != raw_port:
        raise RuntimeError("SAM worker health port must equal its application port.")
    health_path = os.environ.get("HEALTH_CHECK_PATH")
    if health_path is not None and health_path != "/ping":
        raise RuntimeError("SAM worker health path must be /ping.")
    return port


def main() -> None:
    import uvicorn

    uvicorn.run(
        "sam_worker.app:app",
        host="0.0.0.0",
        port=validated_port(),
        workers=1,
        reload=False,
        access_log=False,
    )


if __name__ == "__main__":
    main()

