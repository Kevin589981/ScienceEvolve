# ScienceEvolve SDK

**English** | [简体中文](./README_zh-CN.md)

Run multi-Agent research workflows from Node.js or the command line. The SDK supports review loops, Git collaboration, workflow evolution, persistent state, and recovery.

The [repository overview](https://github.com/OpenMOSS/ScienceEvolve/blob/main/README.md) covers the quick start, diagrams, 23 source workflows, and upstream acknowledgements.

## Installation and Skill

Requires **Node.js 24+**. Version 0.1.1 is currently distributed from source or a local package. From the source repository root:

```sh
npm ci
npm run install:cli
npm run pack:sdk
```

In another Node project, install the generated package as a dependency. To install only the CLI globally, use the second command instead:

```sh
npm install /absolute/scienceevolve-sdk-0.1.1.tgz
npm install -g /absolute/scienceevolve-sdk-0.1.1.tgz
```

The SDK bundles pi; install Codex, Claude Code, DSH, or [Hermes](docs/hermes-zh.md) as needed. The [configuration-authoring Skill](skills/scienceevolve-sdk/SKILL.md) ships with its references and templates. Copy its directory into the Skills directory used by your coding agent and start a new session. In an installed package it is at `node_modules/@scienceevolve/sdk/skills/scienceevolve-sdk`.

## Configure and start

Choose a dedicated absolute `dataDir`, then [add and test a model gateway](docs/main-cli-zh.md#部署与启动) in that directory. Set each Agent's model, Harness, and reasoning option in your workflow. Use the returned gateway ID when starting:

```sh
scievolve workflow validate /absolute/workflow.json
scievolve start /absolute/workflow.json /absolute/requirement.txt --data-dir /absolute/scienceevolve-data --workspace /absolute/task-project --gateway GATEWAY_ID
```

The task directory must exist, and both it and `dataDir` must use absolute paths. The two directories must be separate, and neither may contain the other. Git-off runs directly in the task directory; Git-on uses isolated worktrees and delivers the integrated result back. Press Ctrl+C to pause, wait for shutdown, then use the printed resume command. Keep one SDK host per data directory.

## Node API

Use a workflow with its model routes already tested in the same `dataDir`:

```js
import { createResearchSdk, loadWorkflowConfig } from '@scienceevolve/sdk';

const sdk = await createResearchSdk({ dataDir: '/absolute/scienceevolve-data' });
try {
  const run = await sdk.start({
    title: 'Research task',
    requirement: 'Describe the task, inputs, and acceptance criteria.',
    workflow: await loadWorkflowConfig('/absolute/workflow.json'),
    workspace: '/absolute/task-project',
    gatewayBindings: { defaultGatewayId: 'GATEWAY_ID' }
  });
  console.log('runId', run.id);
  for await (const event of run.events()) console.log(event);
  const result = await run.wait();
  console.log(result.status, result.artifacts);
  if (result.status !== 'completed') process.exitCode = 2;
} finally {
  await sdk.close();
}
```

`wait()` also returns on pause or interruption. Use `run.snapshot()`, `pause()`, `resume()`, `addInput()`, and `respond()` to inspect and manage tasks. See the [API and lifecycle reference](skills/scienceevolve-sdk/references/usage.md#esm-api) (Chinese).

## Guides

Detailed guides are in Chinese. All links below are included in the package.

| Task | Guide |
| --- | --- |
| Models, reasoning, native login, and deployment | [CLI guide](docs/main-cli-zh.md) |
| Agents, routing, and dynamic reconfiguration | [Workflow reference](skills/scienceevolve-sdk/references/workflow.md) · [Loops](docs/workflow-loops-zh.md) |
| GitHub and parallel collaboration | [Authentication](docs/main-cli-zh.md#github-认证与-git-协作) · [Git-on v3 workflow](examples/main-runtime/workflow.json) |
| Workspaces and input files | [Workspace examples](examples/workspace-examples.md) · [Shared inputs](docs/project-inputs-zh.md) |
| Skills, tools, and experiments | [Skills](skills/scienceevolve-sdk/references/workflow.md#skills-与-mcp) · [MCP](docs/project-mcp-zh.md) · [Inspire / SII](docs/sii-experiments-zh.md) |
| Upgrade an existing deployment | [Naming migration](docs/naming-migration.md) · [Runtime migration](docs/main-runtime-migration-zh.md) |

The API and CLI use the main runtime. `@scienceevolve/sdk/main` and `--engine main` remain explicit aliases. The legacy engine and its package exports have been removed; existing legacy data requires an older release.

The runtime is based on main `6bf6a7bb`; see the [2026-10-16 synchronization notes](docs/main-sync-20261016-zh.md) (Chinese).
