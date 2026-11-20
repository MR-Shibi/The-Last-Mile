"""Live fault-injection switches for the mock DPI rails (admin-controlled, in-memory)."""
import threading

FAULT_NAMES = ("nadra_timeout", "raast_error", "force_low_ocr")

_lock = threading.Lock()
_state: dict[str, bool] = {name: False for name in FAULT_NAMES}


def get_faults() -> dict[str, bool]:
    with _lock:
        return dict(_state)


def set_faults(**updates: bool) -> dict[str, bool]:
    with _lock:
        for k, v in updates.items():
            if k not in FAULT_NAMES:
                raise KeyError(k)
            _state[k] = bool(v)
        return dict(_state)


def is_active(name: str) -> bool:
    with _lock:
        return _state.get(name, False)


def reset_faults() -> None:
    set_faults(**{n: False for n in FAULT_NAMES})
