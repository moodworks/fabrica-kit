"""Fail-closed stand-in for the one unused upstream g_pathmgr import."""


class _DisabledPathManager:
    def open(self, *_args: object, **_kwargs: object) -> None:
        raise RuntimeError("External model weight access is disabled.")


g_pathmgr = _DisabledPathManager()

