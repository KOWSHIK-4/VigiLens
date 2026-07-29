from abc import ABC, abstractmethod
import numpy as np


class BaseDetectionModel(ABC):
    @abstractmethod
    def load(self) -> None:
        ...

    @abstractmethod
    def predict(self, image: np.ndarray) -> list[dict]:
        ...

    @property
    @abstractmethod
    def name(self) -> str:
        ...
