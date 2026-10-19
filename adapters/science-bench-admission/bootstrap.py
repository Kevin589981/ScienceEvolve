"""Expand the immutable portable SDK in this trial's temporary filesystem."""
import os
from pathlib import Path, PurePosixPath
import sys
import tarfile

submission = Path(__file__).resolve().parent
payload = Path('/tmp/scienceevolve-portable-payload')
payload.mkdir()
with tarfile.open(submission/'runtime-payload.tar.gz', 'r:gz') as archive:
    members = archive.getmembers()
    for member in members:
        path = PurePosixPath(member.name)
        if path.is_absolute() or '..' in path.parts or not (member.isdir() or member.isfile()):
            raise ValueError('Invalid portable runtime member')
    archive.extractall(payload, members=members)
runtime = payload/'runtime'
environment = dict(os.environ, PATH=str(runtime)+':'+os.environ.get('PATH', ''))
os.execve(runtime/'node', [str(runtime/'node'), '--require', str(payload/'ipc.cjs'),
          str(payload/'main.mjs'), *sys.argv[1:]], environment)
