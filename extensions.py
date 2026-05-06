"""
Extensiones Flask inicializadas fuera del módulo app para evitar imports circulares.

Los blueprints importan `limiter` desde aquí. La inicialización con la app
se hace en app.py vía `limiter.init_app(app)`.
"""
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

from config import RATE_LIMIT_ENABLED

limiter = Limiter(
    key_func=get_remote_address,
    enabled=RATE_LIMIT_ENABLED,
)