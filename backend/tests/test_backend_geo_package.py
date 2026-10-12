"""Public schema identity at the organized geospatial package boundary."""


def test_route_schemas_are_owned_by_backend_geo_package():
    from backend.gee.schemas import BBoxSchema, ExportRequestSchema
    from backend.routes.export_routes import ExportRequestSchema as ExportRouteSchema
    from backend.routes.gif_routes import BBoxSchema as GifBBoxSchema
    from backend.routes.timeseries_routes import BBoxSchema as SeriesBBoxSchema

    assert BBoxSchema is GifBBoxSchema is SeriesBBoxSchema
    assert ExportRequestSchema is ExportRouteSchema
    assert BBoxSchema.__module__ == "backend.gee.schemas"
    assert ExportRequestSchema.__module__ == "backend.gee.schemas"
