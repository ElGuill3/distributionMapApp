from abc import ABC, abstractmethod

class BaseScraper(ABC):
    @abstractmethod
    def scrape(self) -> None:
        """
        Ejecuta el ciclo de scraping e ingesta.
        Debe guardar el resultado final de forma atómica.
        """
        pass
