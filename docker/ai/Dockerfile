FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir --upgrade pip

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

RUN groupadd -r vigilens && useradd -r -g vigilens vigilens
RUN chown -R vigilens:vigilens /app

# The seeded "Demo Recording" camera is a `video_file` source, and it is the one
# camera a fresh deployment can actually play: OpenCV cannot decode a placeholder,
# so the real clip has to exist inside this image at that exact path.
#
#   demo.mp4       synthetic lobby scene - proves the live pipeline moves real
#                  pixels. Regenerate: python -m tools.make_demo_clip
#   person_test.mp4 real people (from ultralytics' bundled sample image) - lets
#                  the detection, persistence and alerting paths be exercised
#                  end to end. Regenerate: python -m tools.make_person_clip
#
# An operator can still override either at runtime by mounting over /recordings.
RUN mkdir -p /recordings
COPY app/assets/demo.mp4 /recordings/demo.mp4
COPY app/assets/person_test.mp4 /recordings/person_test.mp4

USER vigilens

# `--chown` matters: a plain `COPY . .` writes as root and would hand the
# service user a root-owned tree again. The AI service writes annotated
# snapshots into /app/app/output at runtime, so if that directory ends up
# root-owned every imwrite fails with "permission denied" and detections are
# persisted with an image reference to a file that was never created.
COPY --chown=vigilens:vigilens . .

# Annotated snapshots are runtime output, never build input. Create the
# directory with the right owner so the service can write to it on a fresh
# volume or after a rebuild.
RUN mkdir -p /app/app/output && chown -R vigilens:vigilens /app/app/output

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
