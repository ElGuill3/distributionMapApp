import os
import pytest
from unittest.mock import MagicMock, patch
from pathlib import Path
from scrapers.conagua import ConaguaScraper

class TestConaguaScraper:
    def test_conagua_scraper_successful_download(self, tmp_path: Path) -> None:
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
            mock_ftp_class.assert_called_once_with("sih.conagua.gob.mx")
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

    def test_conagua_scraper_station_not_found(self, tmp_path: Path) -> None:
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
