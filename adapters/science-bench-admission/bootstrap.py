"""Expand the immutable portable SDK in this trial's temporary filesystem."""
import json
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
    archive.extractall(payload, members=members, filter='data')
runtime = payload/'runtime'
# Retain only non-secret scientific settings across the SDK environment filter.
# HOME, provider credentials and SDK control identity remain invocation-owned.
scientific_keys = '''PYTHONPATH PYTHONNOUSERSITE PYTHONDONTWRITEBYTECODE
LD_LIBRARY_PATH LIBRARY_PATH C_INCLUDE_PATH CPLUS_INCLUDE_PATH PKG_CONFIG_PATH OCTAVE_HOME
MAX_BUILD_CORES OMP_NUM_THREADS OPENBLAS_NUM_THREADS MKL_NUM_THREADS NUMBA_NUM_THREADS
NUMBA_CACHE_DIR MPLCONFIGDIR TF_NUM_INTEROP_THREADS TF_NUM_INTRAOP_THREADS
JAX_PLATFORMS JAX_ENABLE_X64 XLA_PYTHON_CLIENT_PREALLOCATE DGLBACKEND KERAS_BACKEND
TF_CPP_MIN_LOG_LEVEL PYDEVD_DISABLE_FILE_VALIDATION'''.split()
environment_file = payload/'exam-runtime-env.json'
environment_file.write_text(json.dumps({key: os.environ[key] for key in scientific_keys if key in os.environ}))
environment_file.chmod(0o600)
environment = dict(os.environ, PATH=str(runtime)+':'+os.environ.get('PATH', ''))
os.execve(runtime/'node', [str(runtime/'node'), '--require', str(payload/'ipc.cjs'),
          str(payload/'main.mjs'), *sys.argv[1:]], environment)
