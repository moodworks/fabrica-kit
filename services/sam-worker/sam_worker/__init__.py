"""Isolated SAM mask worker; it is not the Fabrica application backend."""

from .handler import handle_job

__all__ = ["handle_job"]
