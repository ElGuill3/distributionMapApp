import os
import pytest
from unittest.mock import MagicMock, patch
from pathlib import Path
from scrapers.conagua import ConaguaScraper

class TestConaguaScraper:
    @patch("scrapers.conagua.requests.get")
    def test_conagua_scraper_successful_download(self, mock_get, tmp_path: Path) -> None:
        # Mock de requests.get para que falle y obligue a usar el fallback de FTP
        mock_get.side_effect = Exception("Simulated connection error")
        stations = ["BDCTB"]
        output_dir = tmp_path / "stations"
        
        # Mock de la instancia FTP
        mock_ftp_instance = MagicMock()
        mock_ftp_instance.nlst.return_value = ["BDCTB.CSV", "SPTTB.CSV"]
        
        # Simular la descarga pasándole datos ficticios al callback de retrbinary
        def mock_retrbinary(cmd, callback):
            callback(b"Clave: BDCTB\nEstacion: Boca del Cerro\n")
            return b""
            
        mock_ftp_instance.retrbinary.side_effect = mock_retrbinary

        with patch("scrapers.conagua.FTP") as mock_ftp_class:
            mock_ftp_class.return_value.__enter__.return_value = mock_ftp_instance
            
            scraper = ConaguaScraper("hidros", stations, output_dir=output_dir)
            scraper.scrape()
            
            # Verificaciones
            mock_ftp_class.assert_called_once_with("sih.conagua.gob.mx", timeout=10)
            mock_ftp_instance.login.assert_called_once_with("hidros", "hidros")
            mock_ftp_instance.nlst.assert_called_once()
            mock_ftp_instance.retrbinary.assert_called_once()
            
            # El archivo final debe existir con el contenido correcto
            target_file = output_dir / "BDCTB.csv"
            assert target_file.exists()
            with open(target_file, "r") as f:
                content = f.read()
            assert "Boca del Cerro" in content
            
            # No deben quedar temporales
            temp_files = list(output_dir.glob("*.tmp"))
            assert len(temp_files) == 0

    @patch("scrapers.conagua.requests.get")
    def test_conagua_scraper_station_not_found(self, mock_get, tmp_path: Path) -> None:
        # Mock de requests.get para que falle y obligue a usar el fallback de FTP
        mock_get.side_effect = Exception("Simulated connection error")
        stations = ["UNKNOWN"]
        output_dir = tmp_path / "stations"
        
        mock_ftp_instance = MagicMock()
        mock_ftp_instance.nlst.return_value = ["BDCTB.CSV", "SPTTB.CSV"]

        with patch("scrapers.conagua.FTP") as mock_ftp_class:
            mock_ftp_class.return_value.__enter__.return_value = mock_ftp_instance
            
            scraper = ConaguaScraper("hidros", stations, output_dir=output_dir)
            scraper.scrape()
            
            # No se debió llamar a retrbinary para una estación inexistente
            mock_ftp_instance.retrbinary.assert_not_called()
            assert not (output_dir / "UNKNOWN.csv").exists()

    @patch("scrapers.conagua.requests.get")
    def test_conagua_scraper_successful_download_https(self, mock_get, tmp_path: Path) -> None:
        stations = ["BDCTB"]
        output_dir = tmp_path / "stations"
        
        # Mock de la respuesta de requests.get para que sea exitosa
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = "Clave: BDCTB\nEstacion: Boca del Cerro (HTTPS)\n"
        mock_get.return_value = mock_response

        # Instanciar scraper y ejecutar descarga (no debería tocar FTP)
        scraper = ConaguaScraper("hidros", stations, output_dir=output_dir)
        scraper.scrape()
        
        # Verificaciones
        mock_get.assert_called_once()
        
        target_file = output_dir / "BDCTB.csv"
        assert target_file.exists()
        with open(target_file, "r") as f:
            content = f.read()
        assert "Boca del Cerro (HTTPS)" in content
        
        # No deben quedar temporales
        temp_files = list(output_dir.glob("*.tmp"))
        assert len(temp_files) == 0
