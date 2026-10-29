// Same one-shot contract as `openclaw infer model run`, retaining reported usage.
// No agent context, tools, user-selectable model, or credentials cross this boundary.
import { realpathSync } from 'node:fs';
import { readModelMessage } from './mygrain_model_input.mjs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const sdk = pathToFileURL(join(dirname(realpathSync('/usr/bin/openclaw')), 'dist/plugin-sdk/gateway-runtime.js'));
const { callGatewayFromCli } = await import(sdk.href);
const message = await readModelMessage();
const response = await callGatewayFromCli('agent', { timeout: '75000', json: true, expectFinal: true }, {
    sessionId: 'model-run-' + randomUUID(), message,
    provider: 'openai', model: 'gpt-6.1-sol', thinking: 'low',
    modelRun: true, promptMode: 'none', cleanupBundleMcpOnRunEnd: true,
    idempotencyKey: randomUUID()
}, { clientName: 'gateway-client', mode: 'backend', scopes: ['operator.admin'], progress: false });
const result = response.result, meta = result?.meta?.agentMeta;
if (response.status !== 'ok' || !meta || meta.provider !== 'openai' || meta.model !== 'gpt-6.1-sol') throw Error('Unexpected model result.');
process.stdout.write(JSON.stringify({ outputs: (result.payloads || []).map(p => ({ text: p.text })), usage: meta.usage }));
