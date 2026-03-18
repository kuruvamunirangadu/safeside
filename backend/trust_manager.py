import time
from enum import Enum
from typing import Dict


class TrustLevel(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class TrustManager:
    """Compatibility trust manager.

    This class is restored to preserve the original module surface for imports
    and future extension. The active runtime trust source of truth remains in
    RobotState.trust_state.
    """

    def __init__(self, initial: TrustLevel = TrustLevel.MEDIUM) -> None:
        self.level = initial
        self.last_update = time.time()
        self.safe_seconds = 0.0
        self.emergency_count = 0

    def tick_safe(self, dt: float = 1.0) -> None:
        self.safe_seconds += dt
        if self.safe_seconds >= 60.0:
            self._increase()
            self.safe_seconds = 0.0
        self.last_update = time.time()

    def record_emergency(self) -> None:
        self.emergency_count += 1
        self._decrease(times=2)
        self.last_update = time.time()

    def _increase(self) -> None:
        if self.level is TrustLevel.LOW:
            self.level = TrustLevel.MEDIUM
        elif self.level is TrustLevel.MEDIUM:
            self.level = TrustLevel.HIGH

    def _decrease(self, times: int = 1) -> None:
        for _ in range(times):
            if self.level is TrustLevel.HIGH:
                self.level = TrustLevel.MEDIUM
            elif self.level is TrustLevel.MEDIUM:
                self.level = TrustLevel.LOW

    def get_level(self) -> TrustLevel:
        return self.level

    def to_dict(self) -> Dict[str, float | int | str]:
        return {
            "level": self.level.value,
            "safe_seconds": self.safe_seconds,
            "emergency_count": self.emergency_count,
            "last_update": self.last_update,
        }
