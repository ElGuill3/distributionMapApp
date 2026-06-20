import os

files = [
    'templates/index.html',
    'src/ts/types.ts',
    'src/ts/state/mapState.ts',
    'src/ts/apiClient.ts',
    'src/ts/ui/chart.ts',
    'src/ts/modes/compareMode.ts',
    'src/ts/main.ts',
    'static/styles.css'
]

for f in files:
    if os.path.exists(f):
        print(f"Converting {f}...")
        with open(f, 'rb') as r:
            data = r.read()
        converted = data.replace(b'\r\n', b'\n')
        with open(f, 'wb') as w:
            w.write(converted)
