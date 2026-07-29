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
    def detect(self, image: np.ndarray) -> List[Detection]:
        ...

    @abstractmethod
    def draw(self, image: np.ndarray, detections: List[Detection]) -> np.ndarray:
        ...

    @property
    @abstractmethod
    def name(self) -> str:
        ...
