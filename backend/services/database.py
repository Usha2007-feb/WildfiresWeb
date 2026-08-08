import os
import logging
import psycopg2
from psycopg2.pool import ThreadedConnectionPool
from psycopg2.extras import RealDictCursor

logger = logging.getLogger(__name__)

_pool: ThreadedConnectionPool | None = None
_available = False


def get_pool() -> ThreadedConnectionPool | None:
    global _pool, _available
    if _pool is not None:
        return _pool

    url = os.environ.get("DATABASE_URL", "")
    if not url:
        logger.warning("DATABASE_URL not set — running without database")
        return None

    try:
        _pool = ThreadedConnectionPool(minconn=2, maxconn=10, dsn=url)
        _available = True
        init_schema()
        logger.info("Connected to NeonDB Postgres")
    except Exception as e:
        logger.error(f"Database connection failed: {e}")
        _available = False
        _pool = None

    return _pool


def is_available() -> bool:
    return _available and _pool is not None


def init_schema():
    pool = get_pool()
    if pool is None:
        return

    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS postgis;")

            cur.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    email VARCHAR(255) UNIQUE NOT NULL,
                    password_hash VARCHAR(255) NOT NULL,
                    role VARCHAR(50) NOT NULL DEFAULT 'viewer',
                    full_name VARCHAR(255),
                    is_active BOOLEAN NOT NULL DEFAULT true,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    last_login TIMESTAMPTZ
                );
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS zones (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    type VARCHAR(50) NOT NULL,
                    state VARCHAR(100),
                    district VARCHAR(100),
                    area_ha REAL,
                    metadata JSONB DEFAULT '{}'::jsonb,
                    geom GEOMETRY(Geometry, 4326),
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_zones_geom ON zones USING GIST(geom);")

            cur.execute("""
                CREATE TABLE IF NOT EXISTS zone_hierarchy (
                    id SERIAL PRIMARY KEY,
                    parent_zone_id INTEGER REFERENCES zones(id) ON DELETE CASCADE,
                    child_zone_id INTEGER REFERENCES zones(id) ON DELETE CASCADE,
                    UNIQUE(parent_zone_id, child_zone_id)
                );
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS alerts_history (
                    id SERIAL PRIMARY KEY,
                    zone_id INTEGER REFERENCES zones(id) ON DELETE SET NULL,
                    lat REAL NOT NULL,
                    lon REAL NOT NULL,
                    geom GEOMETRY(Point, 4326),
                    brightness REAL,
                    frp REAL,
                    confidence CHAR(1),
                    acquisition_date DATE,
                    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    dedup_key VARCHAR(64),
                    status VARCHAR(20) DEFAULT 'active'
                );
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_alerts_zone ON alerts_history(zone_id);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_alerts_date ON alerts_history(detected_at);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_alerts_geom ON alerts_history USING GIST(geom);")

            cur.execute("""
                CREATE TABLE IF NOT EXISTS vegetation_history (
                    id SERIAL PRIMARY KEY,
                    zone_id INTEGER REFERENCES zones(id) ON DELETE CASCADE,
                    year INTEGER NOT NULL,
                    month INTEGER NOT NULL,
                    ndvi REAL NOT NULL,
                    vegetation_cover_pct REAL DEFAULT 0,
                    disturbance_pct REAL DEFAULT 0,
                    notes TEXT,
                    UNIQUE(zone_id, year, month)
                );
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_veg_zone ON vegetation_history(zone_id);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_veg_year ON vegetation_history(year);")

            cur.execute("""
                CREATE TABLE IF NOT EXISTS points_of_interest (
                    id SERIAL PRIMARY KEY,
                    zone_id INTEGER REFERENCES zones(id) ON DELETE CASCADE,
                    name VARCHAR(255) NOT NULL,
                    type VARCHAR(50) NOT NULL,
                    lat REAL NOT NULL,
                    lon REAL NOT NULL,
                    geom GEOMETRY(Point, 4326),
                    metadata JSONB DEFAULT '{}'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_poi_zone ON points_of_interest(zone_id);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_poi_geom ON points_of_interest USING GIST(geom);")

            conn.commit()
            logger.info("Database schema initialized")
    except Exception as e:
        conn.rollback()
        logger.error(f"Schema init failed: {e}")
    finally:
        pool.putconn(conn)


def query(sql: str, params: tuple = None) -> list[dict]:
    """Run a SELECT query and return results as list of dicts."""
    pool = get_pool()
    if pool is None:
        return []
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
            return [dict(r) for r in rows]
    except Exception as e:
        logger.error(f"Query failed: {e}")
        return []
    finally:
        pool.putconn(conn)


def execute(sql: str, params: tuple = None) -> int:
    """Run INSERT/UPDATE/DELETE and return affected row count."""
    pool = get_pool()
    if pool is None:
        return 0
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            conn.commit()
            return cur.rowcount
    except Exception as e:
        conn.rollback()
        logger.error(f"Execute failed: {e}")
        return 0
    finally:
        pool.putconn(conn)


def execute_returning(sql: str, params: tuple = None) -> dict | None:
    """Run INSERT with RETURNING and return the new row."""
    pool = get_pool()
    if pool is None:
        return None
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            conn.commit()
            row = cur.fetchone()
            return dict(row) if row else None
    except Exception as e:
        conn.rollback()
        logger.error(f"Execute returning failed: {e}")
        return None
    finally:
        pool.putconn(conn)
