"""Build a source-only ZIP without runtime data, credentials, caches, or dependencies."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
output = root / 'artifacts' / 'techly-platform.zip'
output.parent.mkdir(exist_ok=True)
excluded = {'node_modules', '.next', '.git', '.local', '.npm-cache', 'artifacts', '__pycache__', '.agents', '.codex', '.aws'}

def sources(directory):
    for item in sorted(directory.iterdir()):
        if item.name in excluded:
            continue
        if item.is_dir():
            yield from sources(item)
        elif not ((item.name.startswith('.env') and item.name != '.env.example') or item.suffix in {'.log','.tsbuildinfo','.pyc'}):
            yield item

with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for path in sources(root):
        archive.write(path, path.relative_to(root).as_posix())
with ZipFile(output) as archive:
    assert archive.testzip() is None
    assert not any(n.startswith('.local/') or n == '.env.local' or n == '.env.database' for n in archive.namelist())
    print(f'Packaged {len(archive.namelist())} source files: {output} ({output.stat().st_size:,} bytes)')
