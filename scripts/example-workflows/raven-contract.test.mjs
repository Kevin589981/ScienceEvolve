import test from 'node:test';
import assert from 'node:assert/strict';
import { validateScopedWorkflowContract } from '../../sdk/dist/core/scoped-workflow-contract.js';
import { planScopedInputFanOut, planScopedSuccessor } from '../../sdk/dist/core/scoped-workflow-planner.js';
const graph = { schemaVersion: 1, rootAgentIds: ['main'], groups: [{ id: 'research', leaderAgentId: 'manager', allowLeaderReconfiguration: true, workflow: {
  nodes: [{ kind: 'agent', nodeId: 'A', agentId: 'worker_a' }, { kind: 'agent', nodeId: 'B', agentId: 'worker_b' }, { kind: 'agent', nodeId: 'C', agentId: 'worker_c' }],
  input: { source: 'input', edges: [{ kind: 'parallel', target: 'A' }, { kind: 'parallel', target: 'B' }] },
  routes: { A: [{ kind: 'strong', target: 'C' }], B: [{ kind: 'strong', target: 'C' }], C: [{ kind: 'strong', target: 'finish' }] }
} }] };
const agents = new Set(['main','manager','worker_a','worker_b','worker_c']);
test('latest SDK supports genuine native scoped fan-out, not the old single-worker assumption', () => {
  const checked = validateScopedWorkflowContract(graph, agents);
  const activations = planScopedInputFanOut(checked.groups[0].workflow,'group1',1);
  assert.equal(activations.length,2); assert.notEqual(activations[0].requestId,activations[1].requestId);
});
test('a simple fan-in is two path activations, not an AND dependency barrier', () => {
  const workflow = validateScopedWorkflowContract(graph,agents).groups[0].workflow;
  const a = planScopedSuccessor(workflow,'group1',1,'A','A-completed');
  const b = planScopedSuccessor(workflow,'group1',1,'B','B-completed');
  assert.equal(a.activation.targetNodeId,'C'); assert.equal(b.activation.targetNodeId,'C');
  assert.notEqual(a.activation.requestId,b.activation.requestId);
});
test('arbitrary DAG dependsOn is not an accepted direct scoped contract', () => {
  const changed = structuredClone(graph); changed.groups[0].workflow.nodes[2].dependsOn=['A','B'];
  assert.throws(()=>validateScopedWorkflowContract(changed,agents), /unrecognized|Unrecognized/);
});
