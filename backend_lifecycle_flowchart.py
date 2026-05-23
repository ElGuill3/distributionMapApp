# backend_lifecycle_flowchart.py
# Generado automáticamente por la skill flowchart-generator
# Modificar este script para actualizar el diagrama

import graphviz

def generate_chart():
    dot = graphviz.Digraph(
        name="backend_lifecycle",
        format="pdf",
        graph_attr={
            "rankdir": "TB",
            "splines": "true",
            "nodesep": "0.6",
            "ranksep": "0.6",
            "fontname": "Helvetica",
            "fontsize": "16",
            "labelloc": "t",
            "label": "distributionMapApp - Backend Lifecycle Diagram",
        },
        node_attr={
            "fontname": "Helvetica",
            "fontsize": "11",
            "style": "filled,rounded",
            "penwidth": "1.5",
        },
        edge_attr={
            "fontname": "Helvetica",
            "fontsize": "9",
            "color": "#4A5568",
            "penwidth": "1.2",
        }
    )

    # 1. Bootup Flow Subgraph
    with dot.subgraph(name="cluster_bootup") as c:
        c.attr(
            label="1. Arranque del Servidor (Bootup Flow)",
            color="#CBD5E0",
            style="dashed,rounded",
            bgcolor="#F8FAFC",
            fontname="Helvetica",
            fontsize="13",
        )
        
        c.node("boot_start", "Inicio del Servidor", shape="oval", fillcolor="#D4EDDA", color="#28A745", fontcolor="#155724")
        c.node("boot_config", "Configurar logging estructurado\ny cargar variables de entorno", shape="box", fillcolor="#D1ECF1", color="#17A2B8", fontcolor="#0C5460")
        c.node("boot_gee", "Inicializar Google Earth Engine\n(ee.Initialize)", shape="box", fillcolor="#D1ECF1", color="#17A2B8", fontcolor="#0C5460")
        c.node("boot_daemon", "Lanzar hilo daemon de limpieza\nde GIFs temporales en 2do plano", shape="box", fillcolor="#D1ECF1", color="#17A2B8", fontcolor="#0C5460")
        c.node("boot_flask", "Instanciar App Flask\ne inicializar Rate Limiter", shape="box", fillcolor="#D1ECF1", color="#17A2B8", fontcolor="#0C5460")
        c.node("boot_blueprints", "Registrar Blueprints de la API:\n(gif, ts, flood, station, progress, export)", shape="box", fillcolor="#D1ECF1", color="#17A2B8", fontcolor="#0C5460")
        c.node("boot_running", "Servidor Listo y Escuchando\n(Puerto 5000 / debug)", shape="doublecircle", fillcolor="#F8D7DA", color="#DC3545", fontcolor="#721C24", style="filled")

        c.edge("boot_start", "boot_config")
        c.edge("boot_config", "boot_gee")
        c.edge("boot_gee", "boot_daemon")
        c.edge("boot_daemon", "boot_flask")
        c.edge("boot_flask", "boot_blueprints")
        c.edge("boot_blueprints", "boot_running")

    # 2. Request Lifecycle Subgraph
    with dot.subgraph(name="cluster_request") as c:
        c.attr(
            label="2. Ciclo de Vida de una Petición (Request Lifecycle Flow)",
            color="#CBD5E0",
            style="dashed,rounded",
            bgcolor="#F8FAFC",
            fontname="Helvetica",
            fontsize="13",
        )
        
        c.node("req_start", "Recibir Petición HTTP\n(GET/POST/etc.)", shape="oval", fillcolor="#D4EDDA", color="#28A745", fontcolor="#155724")
        
        # Decision: Limiter
        c.node("dec_limiter", "¿Supera el rate limit?\n(Flask-Limiter)", shape="diamond", fillcolor="#FFF3CD", color="#FFC107", fontcolor="#856404")
        c.node("res_429", "Retornar HTTP 429\n(Rate Limit Exceeded)", shape="parallelogram", fillcolor="#E2E3E5", color="#6C757D", fontcolor="#383D41")
        
        # Decision: Route match
        c.node("dec_route", "¿Coincide con\nuna ruta válida?", shape="diamond", fillcolor="#FFF3CD", color="#FFC107", fontcolor="#856404")
        c.node("res_404", "Retornar HTTP 404\n(Not Found)", shape="parallelogram", fillcolor="#E2E3E5", color="#6C757D", fontcolor="#383D41")
        
        # Handler & Service execution
        c.node("proc_handler", "Invocar Controller / Handler\nde Blueprint correspondiente", shape="box", fillcolor="#D1ECF1", color="#17A2B8", fontcolor="#0C5460")
        c.node("proc_services", "Ejecutar servicios de dominio\n(GEE, PDF Report, Export, etc.)", shape="box", fillcolor="#D1ECF1", color="#17A2B8", fontcolor="#0C5460")
        
        # Decision: Status >= 400
        c.node("dec_status", "¿Código de estado\nes de error? (>= 400)", shape="diamond", fillcolor="#FFF3CD", color="#FFC107", fontcolor="#856404")
        c.node("cache_no_store", "Establecer cabecera\nCache-Control: no-store", shape="box", fillcolor="#D1ECF1", color="#17A2B8", fontcolor="#0C5460")
        
        # Decision: Cache policy
        c.node("dec_cache_policy", "¿Coincide la ruta con\nCACHE_POLICIES?", shape="diamond", fillcolor="#FFF3CD", color="#FFC107", fontcolor="#856404")
        c.node("cache_inject", "Establecer Cache-Control\ny generar MD5 ETag", shape="box", fillcolor="#D1ECF1", color="#17A2B8", fontcolor="#0C5460")
        c.node("cache_none", "Continuar sin cabeceras\nde caché adicionales", shape="box", fillcolor="#D1ECF1", color="#17A2B8", fontcolor="#0C5460")
        
        c.node("req_end", "Enviar Respuesta\nal Cliente", shape="oval", fillcolor="#F8D7DA", color="#DC3545", fontcolor="#721C24")

        c.edge("req_start", "dec_limiter")
        c.edge("dec_limiter", "res_429", label="Sí")
        c.edge("dec_limiter", "dec_route", label="No")
        
        c.edge("dec_route", "res_404", label="No")
        c.edge("dec_route", "proc_handler", label="Sí")
        
        c.edge("proc_handler", "proc_services")
        c.edge("proc_services", "dec_status")
        
        c.edge("dec_status", "cache_no_store", label="Sí")
        c.edge("dec_status", "dec_cache_policy", label="No")
        
        c.edge("dec_cache_policy", "cache_inject", label="Sí")
        c.edge("dec_cache_policy", "cache_none", label="No")
        
        c.edge("res_429", "req_end")
        c.edge("res_404", "req_end")
        c.edge("cache_no_store", "req_end")
        c.edge("cache_inject", "req_end")
        c.edge("cache_none", "req_end")

    # Render diagram
    output_path = dot.render(
        filename="backend_lifecycle",
        cleanup=True,
        view=False
    )
    print(f"Diagram output path: {output_path}")

if __name__ == "__main__":
    generate_chart()
