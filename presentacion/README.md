# Presentación del Proyecto

Esta carpeta contiene los archivos necesarios para la presentación del proyecto en LaTeX.

## Archivos Incluidos

- `presentacion.tex` - Archivo principal de LaTeX con la presentación
- `guion-presentacion.md` - Guion detallado para la exposición oral
- `lista-imagenes.md` - Lista detallada de todas las imágenes necesarias

## Estructura de Carpetas

```
presentacion/
├── presentacion.tex
├── guion-presentacion.md
├── lista-imagenes.md
├── README.md
└── imagenes/          (crear esta carpeta)
    ├── 01-aplicacion-completa.png
    ├── 02-diagrama-flujo.png
    ├── ... (todas las imágenes)
```

## Instrucciones de Compilación

### Requisitos Previos

1. Instalar una distribución de LaTeX:
   - **Windows**: MiKTeX o TeX Live
   - **macOS**: MacTeX
   - **Linux**: TeX Live (usualmente disponible en repositorios)

2. Paquetes necesarios (se instalarán automáticamente si usas MiKTeX o TeX Live):
   - beamer
   - babel (con opción spanish)
   - graphicx
   - tikz
   - fontawesome5 (opcional, para iconos)

### Compilación

1. Abre el archivo `presentacion.tex` en tu editor de LaTeX preferido (TeXstudio, TeXworks, Overleaf, etc.)

2. Compila el documento:
   - **PDFLaTeX**: Compila directamente a PDF
   - **XeLaTeX**: Alternativa que puede manejar mejor fuentes especiales
   - **LuaLaTeX**: Otra alternativa moderna

3. Si usas la línea de comandos:
   ```bash
   pdflatex presentacion.tex
   # Ejecutar dos veces para referencias cruzadas
   pdflatex presentacion.tex
   ```

### Nota sobre Imágenes

**IMPORTANTE**: Antes de compilar, debes:
1. Crear la carpeta `imagenes/` dentro de `presentacion/`
2. Capturar o crear todas las imágenes listadas en `lista-imagenes.md`
3. Guardar las imágenes con los nombres exactos especificados en el archivo `.tex`

Si alguna imagen no está disponible, puedes comentar temporalmente las líneas correspondientes en el archivo `.tex` usando `%` al inicio de la línea.

## Personalización

### Cambiar Información Personal

En el archivo `presentacion.tex`, busca las siguientes líneas y modifícalas:

```latex
\author{Tu Nombre}
\institute{Institución}
\date{\today}
```

### Cambiar Colores

Los colores están definidos al inicio del documento:

```latex
\definecolor{primaryblue}{RGB}{0,102,204}
\definecolor{secondarygreen}{RGB}{0,153,51}
\definecolor{accentorange}{RGB}{255,120,0}
```

Puedes modificar estos valores RGB para cambiar la paleta de colores.

### Cambiar Tema

El tema actual es "Madrid". Puedes cambiarlo por otros temas de Beamer:

```latex
\usetheme{Madrid}  % Cambiar por: Berlin, Copenhagen, Darmstadt, etc.
```

Temas populares:
- `Madrid` - Moderno y limpio (actual)
- `Berlin` - Más estructurado
- `Copenhagen` - Minimalista
- `Darmstadt` - Con barras laterales
- `Warsaw` - Con barras superiores

## Uso del Guion

El archivo `guion-presentacion.md` contiene:
- Texto detallado para cada diapositiva
- Tiempos estimados
- Puntos clave a enfatizar
- Consejos de presentación

**Recomendación**: Lee el guion completo varias veces antes de la presentación y practica en voz alta para ajustar el tiempo y el ritmo.

## Solución de Problemas

### Error: "File not found" para imágenes
- Verifica que la carpeta `imagenes/` existe
- Verifica que los nombres de archivo coinciden exactamente (incluyendo mayúsculas/minúsculas)
- Verifica las extensiones de archivo (.png, .jpg, etc.)

### Error: Paquete no encontrado
- Si usas MiKTeX, ejecuta el instalador de paquetes
- Si usas TeX Live, ejecuta `tlmgr install [nombre-paquete]`

### La presentación no se ve bien
- Verifica que compilaste con PDFLaTeX (no LaTeX)
- Verifica que tienes todos los paquetes instalados
- Intenta compilar dos veces seguidas

## Recursos Adicionales

- [Documentación de Beamer](https://ctan.org/pkg/beamer)
- [Guía de Beamer (en español)](http://metodos.fam.cie.uva.es/~latex/apuntes/apuntes10.pdf)
- [Overleaf - Editor LaTeX online](https://www.overleaf.com/)

## Notas Finales

- La presentación está diseñada para formato 16:9 (widescreen)
- El diseño es limpio y profesional, con énfasis en imágenes
- El texto es mínimo, diseñado como apoyo visual
- Todas las imágenes deben ser de alta calidad para una buena presentación
