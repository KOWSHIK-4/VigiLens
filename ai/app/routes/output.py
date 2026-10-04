import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from app.routes.detection import OUTPUT_DIR
from app.security import verify_internal_key

logger = logging.getLogger(__name__)

# Machine-to-machine only. This router is deliberately NOT mounted under the
# `/detect` prefix that nginx exposes to browsers, so annotated snapshots can
# only be fetched by the backend, which owns tenancy and authentication. A
# browser can never reach these files directly.
router = APIRouter(
    prefix="/internal",
    tags=["internal"],
    dependencies=[Depends(verify_internal_key)],
)


@router.get("/output/{filename}")
async def get_output_file(filename: str) -> FileResponse:
    """Serve a single annotated snapshot from OUTPUT_DIR by bare filename."""
    # Reject anything that is not a plain file name before touching the disk:
    # separators, traversal and absolute paths are all refused outright.
    if filename != Path(filename).name or filename.startswith("."):
        raise HTTPException(status_code=400, detail="Invalid snapshot filename")

    output_dir = OUTPUT_DIR.resolve()
    path = (output_dir / filename).resolve()
    # Belt-and-braces containment check in case the name check above is ever
    # relaxed: the resolved file must live directly inside OUTPUT_DIR.
    if path.parent != output_dir or not path.is_file():
        raise HTTPException(status_code=404, detail="Snapshot not found")

    return FileResponse(path, media_type="image/jpeg")