import os
from config import _env_list

class TestConfigEnvList:
    def test_env_list_default(self) -> None:
        if "TEST_ENV_VAR" in os.environ:
            del os.environ["TEST_ENV_VAR"]
        assert _env_list("TEST_ENV_VAR", "A,B") == ["A", "B"]
        assert _env_list("TEST_ENV_VAR", "") == []

    def test_env_list_parsing(self) -> None:
        os.environ["TEST_ENV_VAR"] = "  X,  Y,Z , ,W "
        assert _env_list("TEST_ENV_VAR") == ["X", "Y", "Z", "W"]
        
        # Limpieza
        del os.environ["TEST_ENV_VAR"]

    def test_env_list_empty_value(self) -> None:
        os.environ["TEST_ENV_VAR"] = "   "
        assert _env_list("TEST_ENV_VAR") == []
        del os.environ["TEST_ENV_VAR"]
