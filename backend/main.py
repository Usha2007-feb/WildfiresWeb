import sys
import os
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

_file = os.path.abspath(__file__)
_backend_dir = os.path.dirname(_file)
_project_root = os.path.dirname(_backend_dir)
_parent = os.path.dirname(_project_root)

for p in [_project_root, _parent]:
    if p not in sys.path:
        sys.path.insert(0, p)

import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    from backend.routers.heatmap import start_heatmap_worker
    from backend.services.firms import start_firms_worker
    from backend.services.database import get_pool

    get_pool()

    start_heatmap_worker()
    if os.environ.get("FIRMS_API_KEY"):
        start_firms_worker()
        from backend.services.geo_fence import start_geo_fence_worker
        start_geo_fence_worker()

    yield


app = FastAPI(title="Wildfires India API", version="1.0.0", lifespan=lifespan)

ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in ALLOWED_ORIGINS],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from backend.routers.heatmap import router as heatmap_router
from backend.routers.predict import router as predict_router
from backend.routers.tile_route import router as tile_router
from backend.routers.firms_route import router as firms_router
from backend.routers.search import router as search_router
from backend.routers.model_info import router as model_router
from backend.routers.region_analysis import router as region_router
from backend.routers.alerts import router as alerts_router
from backend.routers.auth import router as auth_router
from backend.routers.admin import router as admin_router
from backend.routers.deforestation import router as deforestation_router
from backend.routers.gis import router as gis_router
from backend.routers.monitoring import router as monitoring_router
from backend.routers.reports import router as reports_router
from backend.routers.encroachment import router as encroachment_router

app.include_router(heatmap_router)
app.include_router(predict_router)
app.include_router(tile_router)
app.include_router(firms_router)
app.include_router(search_router)
app.include_router(model_router)
app.include_router(region_router)
app.include_router(alerts_router)
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(deforestation_router)
app.include_router(gis_router)
app.include_router(monitoring_router)
app.include_router(reports_router)
app.include_router(encroachment_router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "wildfires-india-api"}
