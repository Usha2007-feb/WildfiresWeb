$env:DATABASE_URL = "postgresql://neondb_owner:npg_64eAJCEwPDcO@ep-cool-sound-az67xr3o-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"
$env:JWT_SECRET = "local-dev-secret"
$env:PYTHONPATH = "C:\Users\Lenovo\Desktop\wildfire_engine"
$env:FIRMS_API_KEY = "ddd2b8a0e248043cd289a751d54304cf"
$env:SENTINEL_HUB_CLIENT_ID = "sh-049468ea-8df0-4483-8b9d-a7baa8ec40e5"
$env:SENTINEL_HUB_CLIENT_SECRET = "1KqDEKRDOVUHYnPuRjbzVfvA2w1mE47x"
Set-Location C:\Users\Lenovo\Desktop\wildfire_engine
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8001 --reload
