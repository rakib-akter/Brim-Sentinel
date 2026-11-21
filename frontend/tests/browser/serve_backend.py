"""Run FastAPI with disposable seed data for Playwright."""
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from urllib.parse import urlparse

import uvicorn

repo = Path(__file__).resolve().parents[3]
backend = repo / "backend"
origin = urlparse(os.environ["BRIM_BROWSER_BACKEND"])

with TemporaryDirectory(prefix="brim-browser-") as directory:
    os.environ.update(
        PYTHONDONTWRITEBYTECODE="1",
        DEMO_MODE="true",
        AI_ENABLED="false",
        BRIM_DATA_DIR=str(repo / "data" / "brim_ap_dataset"),
        BRIM_UPLOAD_DIR=str(Path(directory) / "uploads"),
        DATABASE_URL=f"sqlite:///{Path(directory) / 'test.db'}",
    )
    os.chdir(backend)
    sys.path.insert(0, str(backend))
    sys.dont_write_bytecode = True
    subprocess.run([sys.executable, "-m", "scripts.seed"], check=True, stdout=subprocess.DEVNULL)
    uvicorn.run("app.main:app", host=origin.hostname, port=origin.port)
