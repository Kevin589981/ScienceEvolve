#!/usr/bin/env python3
"""Restore only the scientific settings captured inside this trial's sandbox."""
import json
import os
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parent
settings = json.loads((root/'exam-runtime-env.json').read_text())
os.environ.update(settings)
if sys.argv[1:2] == ['--exam-environment-probe']:
    # A fresh scientific Python applies PYTHONPATH during startup.
    code = '''import importlib,json,os,sys
keys=json.loads(sys.argv[1])
result={"environment":{key:os.environ.get(key) for key in keys},"python_path":sys.path}
if len(sys.argv)>2:result["imported_module_file"]=importlib.import_module(sys.argv[2]).__file__
print(json.dumps(result))
'''
    raise SystemExit(subprocess.call([sys.executable, '-c', code, json.dumps(list(settings)), *sys.argv[2:]]))
node = str(root/'runtime/node')
cli = str(root/'vendor/node_modules/@earendil-works/pi-coding-agent/dist/cli.js')
os.execv(node, [node, cli, *sys.argv[1:]])
