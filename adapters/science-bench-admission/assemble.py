"""Assemble the built SDK, Linux Node and adapter as ordinary submission files."""
import argparse
import json
from pathlib import Path
import shutil
import tarfile
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--sdk-root', type=Path, required=True, help='Built ScienceEvolve repository')
parser.add_argument('--node', type=Path, required=True, help='Linux x86_64 Node 24 executable')
parser.add_argument('--output', type=Path, required=True, help='New <student-id>/harness directory')
args = parser.parse_args()
repo = args.sdk_root.resolve()
destination = args.output.resolve()
if destination.exists():
    parser.error('Output exists; choose a new submission directory')
for required in [repo/'sdk/dist/index.js', repo/'node_modules/@earendil-works/pi-coding-agent/dist/cli.js', args.node]:
    if not required.is_file():
        parser.error('Missing build dependency: '+str(required))
destination.mkdir(parents=True)
source = Path(__file__).resolve().parent
for name in ['harness.json', 'README.md', 'scienceevolve-bench', 'bootstrap.py']:
    shutil.copyfile(source/name, destination/name)
(destination/'scienceevolve-bench').chmod(0o755)
with tempfile.TemporaryDirectory(prefix='scienceevolve-package-') as temporary:
    payload = Path(temporary)
    for name in ['main.mjs', 'ipc.cjs', 'transport-test.mjs', 'pi-entry.py']:
        shutil.copyfile(source/name, payload/name)
    (payload/'pi-entry.py').chmod(0o755)
    shutil.copyfile(repo/'example/02-software-development/workflow.json', payload/'workflow.json')
    (payload/'runtime').mkdir()
    shutil.copyfile(args.node, payload/'runtime/node')
    (payload/'runtime/node').chmod(0o755)
    for name in ['dist', 'assets', 'resources']:
        shutil.copytree(repo/'sdk'/name, payload/'vendor/sdk'/name, symlinks=False)
    shutil.copyfile(repo/'sdk/package.json', payload/'vendor/sdk/package.json')
    shutil.copytree(repo/'node_modules', payload/'vendor/node_modules', symlinks=False,
                    ignore=lambda directory, names: [name for name in names if name in {'.bin', '@scienceevolve'}])
    for file in payload.rglob('*'):
        if file.is_symlink():
            raise ValueError('Payload contains a symlink: '+str(file))
        if file.is_file():
            file.chmod(0o755 if file.stat().st_mode & 0o111 else 0o644)
    with tarfile.open(destination/'runtime-payload.tar.gz', 'w:gz', compresslevel=3, dereference=True) as archive:
        for file in sorted(payload.iterdir()):
            archive.add(file, arcname=file.name)
print(json.dumps({'submission': str(destination), 'files': sum(p.is_file() for p in destination.rglob('*'))}))
