import os
import tempfile
import logging
from ftplib import FTP
from pathlib import Path
from scrapers.base import BaseScraper
from config import BASE_DIR

logger = logging.getLogger(__name__)

class ConaguaScraper(BaseScraper):
    def __init__(self, username: str, stations: list[str], output_dir: Path = None):
        self.username = username
        self.password = username  # Credenciales idénticas al nombre de usuario (ej. hidros/hidros)
        self.host = "sih.conagua.gob.mx"
        self.stations = [s.upper() for s in stations if s]
        self.output_dir = output_dir or (BASE_DIR / "data" / "stations")

    def scrape(self) -> None:
        if not self.stations:
            logger.info(f"No hay estaciones configuradas para el scraper de {self.username}.")
            return

        self.output_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"Iniciando descarga FTP desde {self.host} para {self.username}...")

        max_retries = 3
        for attempt in range(1, max_retries + 1):
            try:
                with FTP(self.host) as ftp:
                    ftp.login(self.username, self.password)
                    logger.info(f"Conexión FTP exitosa como {self.username}.")
                    
                    # Listar archivos remotos
                    files = ftp.nlst()
                    file_map = {f.upper(): f for f in files}

                    for station in self.stations:
                        expected_filename = f"{station}.CSV"
                        if expected_filename not in file_map:
                            logger.warning(f"La estación {station} no se encontró en el servidor FTP ({expected_filename}).")
                            continue

                        remote_file = file_map[expected_filename]
                        local_final_path = self.output_dir / f"{station}.csv"
                        
                        logger.info(f"Descargando {remote_file}...")

                        # Escritura atómica usando archivo temporal en el mismo directorio
                        fd, temp_path_str = tempfile.mkstemp(dir=str(self.output_dir), suffix=".tmp")
                        temp_path = Path(temp_path_str)
                        
                        try:
                            with os.fdopen(fd, "wb") as local_file:
                                ftp.retrbinary(f"RETR {remote_file}", local_file.write)
                            
                            # Reemplazo atómico a nivel de sistema operativo
                            os.replace(temp_path, local_final_path)
                            logger.info(f"Descarga de {station} finalizada exitosamente.")
                        except Exception as e:
                            logger.error(f"Error durante la descarga o escritura de {station}: {e}")
                            if temp_path.exists():
                                try:
                                    os.unlink(temp_path)
                                except OSError:
                                    pass
                    
                    # Si terminamos exitosamente, salimos del bucle de reintentos
                    break
            except Exception as e:
                logger.error(f"Fallo en la conexión FTP de {self.username} (intento {attempt}/{max_retries}): {e}")
                if attempt < max_retries:
                    sleep_time = 2 ** attempt
                    logger.info(f"Reintentando en {sleep_time} segundos...")
                    import time
                    time.sleep(sleep_time)
                else:
                    logger.error(f"Se agotaron todos los reintentos para {self.username}. Abortando.")
