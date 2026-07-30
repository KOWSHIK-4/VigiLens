import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    model_path: str = os.getenv("MODEL_PATH", "/app/models")
    log_level: str = os.getenv("LOG_LEVEL", "INFO")
    confidence_threshold: float = float(os.getenv("CONFIDENCE_THRESHOLD", "0.5"))
    max_image_size: int = int(os.getenv("MAX_IMAGE_SIZE", "4096"))
    backend_url: str = os.getenv("BACKEND_URL", "http://localhost:4000")


settings = Settings()
