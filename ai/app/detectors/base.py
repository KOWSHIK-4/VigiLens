from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List
import numpy as np


@dataclass
class Detection:
    class_name: str
    confidence: float
    bbox: tuple[int, int, int, int]


class BaseDetector(ABC):

    @abstractmethod
    def detect(
        self,
        image: np.ndarray,
        confidence_threshold: float | None = None,
    ) -> List[Detection]:
        """Run inference over an image.

        ``confidence_threshold`` overrides the detector's default
        confidence floor for this call when provided (0..1).
        """
        ...

    @abstractmethod
    def draw(self, image: np.ndarray, detections: List[Detection]) -> np.ndarray:
        ...

    @property
    @abstractmethod
    def name(self) -> str:
        ...
