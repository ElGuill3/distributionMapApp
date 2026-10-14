#!/usr/bin/env bash
# Build informe.pdf from ../flood-susceptibility-model.md (single source).
# Needs pandoc and tectonic on PATH (or in /home/linuxbrew/.linuxbrew/bin).
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$PATH:/home/linuxbrew/.linuxbrew/bin"

python3 - <<'EOF'
import re
from pathlib import Path

md = Path("../flood-susceptibility-model.md").read_text(encoding="utf-8")
lines = md.splitlines()
# Title and project line live on the LaTeX title page.
lines = lines[lines.index("## Resumen"):]
# Front and back matter sections carry no number, as in a journal article.
UNNUMBERED = {
    "Resumen",
    "Contribuciones de los autores",
    "Disponibilidad de datos y código",
    "Conflictos de interés",
    "Referencias",
}
out = []
for line in lines:
    if line.strip() == "---":
        continue
    if line[3:] in UNNUMBERED and line.startswith("## "):
        title = line[3:]
        out.append(f"```{{=latex}}\n\\section*{{{title}}}\\addcontentsline{{toc}}{{section}}{{{title}}}\n```")
        continue
    # LaTeX numbers sections itself, in the same order as the Markdown.
    line = re.sub(r"^(#{2,4}) \d+(?:\.\d+)*\.? ", r"\1 ", line)
    out.append(line)
text = "\n".join(out) + "\n"


def figure(path, caption, width="\\textwidth"):
    return (
        "\n```{=latex}\n\\begin{figure}[H]\\centering\n"
        f"\\includegraphics[width={width}]{{{path}}}\n"
        f"\\caption{{{caption}}}\n\\end{{figure}}\n```\n"
    )


def insert_after(anchor, block):
    global text
    assert text.count(anchor) == 1, anchor
    text = text.replace(anchor, anchor + block)


insert_after(
    "con máximos en junio y de septiembre a noviembre [1].\n",
    figure(
        "figures/area_estudio.png",
        "Área de estudio. (a) Tabasco en México; (b) municipios (FAO GAUL 2025) y "
        "ríos principales (HydroSHEDS).",
    ),
)
insert_after(
    "Las temporadas 2023–2025 sí son posteriores a su publicación.\n",
    figure(
        "figures/validacion.png",
        "ROC AUC y PR AUC sobre eventos no vistos por los componentes del ensamble. "
        "La línea negra en PR AUC es la tasa base (proporción inundada).",
    ),
)
insert_after(
    "### Mapa de susceptibilidad\n",
    figure(
        "figures/mapa_clases.png",
        "Mapa de susceptibilidad: clases (quintiles de superficie del estado) "
        "y límites municipales (FAO GAUL 2025).",
    ),
)
insert_after(
    "una ficha por municipio y una vista por municipio.\n",
    figure(
        "figures/app_detalle.jpg",
        "Consulta interactiva del mapa: capa estatal a 30 m, ficha de Nacajuca y "
        "lectura de la clase bajo el cursor.",
    )
    + figure(
        "figures/app_municipios.jpg",
        "Vista por municipio: porcentaje de superficie en susceptibilidad alta o muy alta.",
    ),
)
Path("cuerpo.md").write_text(text, encoding="utf-8")
EOF

pandoc cuerpo.md \
  -f markdown-auto_identifiers+pipe_tables+raw_attribute \
  -t latex --wrap=preserve --columns=100 --no-highlight --shift-heading-level-by=-1 \
  -o cuerpo.tex
rm cuerpo.md
tectonic --keep-logs informe.tex
echo "built $(pwd)/informe.pdf"
