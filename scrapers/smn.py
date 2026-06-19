import logging
from scrapers.base import BaseScraper

logger = logging.getLogger(__name__)

class SmnWeatherScraper(BaseScraper):
    def __init__(self):
        logger.info("Inicializando stub del SMN Weather Scraper...")

    def scrape(self) -> None:
        logger.info("Ejecutando stub del SMN Weather Scraper. Ingesta a futuro para modelos de predicción.")
        # TODO: Implementar consulta a la API de SMN (JSON gzip) e ingesta a DB/archivos.
        pass
