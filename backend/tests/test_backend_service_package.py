"""Public service identity at the organized backend package boundary."""


def test_route_helpers_share_backend_service_package_identities():
    from backend.app import start_cleanup_daemon as app_cleanup_daemon
    from backend.routes.export_routes import (
        create_export_zip as export_route_zip,
    )
    from backend.routes.export_routes import (
        serialize_series_to_csv as export_route_csv,
    )
    from backend.routes.gif_routes import create_progress_queue as gif_route_queue
    from backend.routes.progress_routes import (
        get_progress_queue as progress_route_get,
    )
    from backend.routes.progress_routes import (
        remove_progress_queue as progress_route_remove,
    )
    from backend.routes.station_routes import (
        read_station_level_timeseries as station_route_reader,
    )
    from backend.services.export_service import (
        create_export_zip,
        serialize_series_to_csv,
    )
    from backend.services.gif_service import (
        add_dates_to_gif,
        create_progress_queue,
        get_progress_queue,
        remove_progress_queue,
        start_cleanup_daemon,
    )
    from backend.services.station_service import read_station_level_timeseries

    assert create_export_zip is export_route_zip
    assert serialize_series_to_csv is export_route_csv
    assert create_progress_queue is gif_route_queue
    assert get_progress_queue is progress_route_get
    assert remove_progress_queue is progress_route_remove
    assert start_cleanup_daemon is app_cleanup_daemon
    assert read_station_level_timeseries is station_route_reader
    assert create_export_zip.__module__ == "backend.services.export_service"
    assert add_dates_to_gif.__module__ == "backend.services.gif_service"
    assert start_cleanup_daemon.__module__ == "backend.services.gif_service"
    assert read_station_level_timeseries.__module__ == (
        "backend.services.station_service"
    )
