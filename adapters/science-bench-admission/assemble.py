"""Assemble the built SDK, Linux Node and adapter as ordinary submission files."""
import argparse
import json
from pathlib import Path
import shutil

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
for name in ['harness.json', 'README.md', 'scienceevolve-bench', 'main.mjs', 'ipc.cjs', 'transport-test.mjs']:
    shutil.copyfile(source/name, destination/name)
(destination/'scienceevolve-bench').chmod(0o755)
shutil.copyfile(repo/'example/02-software-development/workflow.json', destination/'workflow.json')
(destination/'runtime').mkdir()
shutil.copyfile(args.node, destination/'runtime/node')
(destination/'runtime/node').chmod(0o755)
for name in ['dist', 'assets', 'resources']:
    shutil.copytree(repo/'sdk'/name, destination/'vendor/sdk'/name, symlinks=False)
shutil.copyfile(repo/'sdk/package.json', destination/'vendor/sdk/package.json')
shutil.copytree(repo/'node_modules', destination/'vendor/node_modules', symlinks=False,
                ignore=lambda directory, names: [name for name in names if name in {'.bin', '@scienceevolve'}])
for file in destination.rglob('*'):
    if file.is_symlink():
        raise ValueError('Submission contains a symlink: '+str(file))
    if file.is_file():
        file.chmod(0o755 if file.stat().st_mode & 0o111 else 0o644)
print(json.dumps({'submission': str(destination), 'files': sum(p.is_file() for p in destination.rglob('*'))}))
