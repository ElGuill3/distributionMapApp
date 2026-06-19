import os
import sys
import logging
from apscheduler.schedulers.blocking import BlockingScheduler
from scrapers.conagua import ConaguaScraper
from scrapers.smn import SmnWeatherScraper
from config import CONAGUA_HIDROS_STATIONS, CONAGUA_CLIMAS_STATIONS

# Configuración de logs básica a stdout para visibilidad en Docker
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)

logger = logging.getLogger("scrapers.runner")

def run_now():
    """Ejecuta todos los scrapers activos de forma inmediata al iniciar (Bootstrap)."""
    logger.info("Ejecutando bootstrap inicial de scrapers...")
    
    if CONAGUA_HIDROS_STATIONS:
        logger.info(f"Ejecución inmediata de Conagua Hidros para: {CONAGUA_HIDROS_STATIONS}")
        scraper = ConaguaScraper("hidros", CONAGUA_HIDROS_STATIONS)
        scraper.scrape()
        
    if CONAGUA_CLIMAS_STATIONS:
        logger.info(f"Ejecución inmediata de Conagua Climas para: {CONAGUA_CLIMAS_STATIONS}")
        scraper = ConaguaScraper("climas", CONAGUA_CLIMAS_STATIONS)
        scraper.scrape()

    # Ejecutar stub de SMN
    smn = SmnWeatherScraper()
    smn.scrape()

def main():
    logger.info("Iniciando orquestador de Scrapers...")
    
    # 1. Bootstrap run
    run_now()
    
    # 2. Configurar planificador
    scheduler = BlockingScheduler()
    
    # Job 1: Hidros semanal (Lunes a las 02:00 AM)
    scheduler.add_job(
        id="conagua_hidros_weekly",
        func=lambda: ConaguaScraper("hidros", CONAGUA_HIDROS_STATIONS).scrape(),
        trigger="cron",
        day_of_week="mon",
        hour=2,
        minute=0
    )
    
    # Job 2: Climas semanal (Lunes a las 02:30 AM)
    scheduler.add_job(
        id="conagua_climas_weekly",
        func=lambda: ConaguaScraper("climas", CONAGUA_CLIMAS_STATIONS).scrape(),
        trigger="cron",
        day_of_week="mon",
        hour=2,
        minute=30
    )
    
    # Job 3: Stub SMN (Cada 1 hora)
    scheduler.add_job(
        id="smn_hourly_stub",
        func=lambda: SmnWeatherScraper().scrape(),
        trigger="interval",
        hours=1
    )
    
    logger.info("Planificador iniciado. Esperando ejecuciones programadas...")
    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("Planificador de tareas detenido exitosamente.")

if __name__ == "__main__":
    main()
