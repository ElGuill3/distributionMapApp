import os

files = [
    'frontend/templates/index.html',
    'frontend/src/ts/types.ts',
    'frontend/src/ts/state/mapState.ts',
    'frontend/src/ts/apiClient.ts',
    'frontend/src/ts/ui/chart.ts',
    'frontend/src/ts/modes/compareMode.ts',
    'frontend/src/ts/main.ts',
    'frontend/src/styles/styles.css'
]

for f in files:
    if os.path.exists(f):
        print(f"Converting {f}...")
        with open(f, 'rb') as r:
            data = r.read()
        converted = data.replace(b'\r\n', b'\n')
        with open(f, 'wb') as w:
            w.write(converted)
