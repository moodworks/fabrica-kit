"""Isolated SAM mask worker; it is not the Fabrica application backend."""

# The FastAPI application deliberately remains at ``sam_worker.app:app`` so importing the
# provider-independent protocol does not require HTTP runtime dependencies.
__all__: list[str] = []
