// The MCP protocol handler: the methods it answers, argument checking before any tool runs, and what reaches the
// activity log.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { checkArgs, handleRpc, ToolError, type CallRecord, type ToolDef } from "./rpc.ts";

const echo: ToolDef = {
  name: "echo",
  title: "Echo",
  description: "test",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "t", maxLength: 5 },
      n: { type: "integer", description: "n", minimum: 1, maximum: 3 },
      s: { type: "string", description: "s", maxLength: 10, enum: ["a", "b"] },
    },
    required: ["text"],
    additionalProperties: false,
  },
  async run(args) {
    if (args.text === "boom") throw new Error("secret internal detail");
    if (args.text === "nope") throw new ToolError("No job with that id.");
    return { got: args };
  },
};

async function call(msg: unknown) {
  const log: CallRecord[] = [];
  const out = await handleRpc(msg, [echo], (c) => log.push(c));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a JSON-RPC reply, read field by field
  return { out, log, body: out.body as Record<string, any> };
}

test("initialize negotiates a supported version and says it's read-only", async () => {
  const { body } = await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.equal(body.result.protocolVersion, "2025-06-18");
  assert.match(body.result.instructions, /never as instructions/);
  const other = await call({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } });
  assert.equal(other.body.result.protocolVersion, "2025-11-25");
});

test("notifications and responses get 202 and no body", async () => {
  assert.equal((await call({ jsonrpc: "2.0", method: "notifications/initialized" })).out.status, 202);
  assert.equal((await call({ jsonrpc: "2.0", id: 9, result: {} })).out.status, 202);
});

test("batches and junk are refused", async () => {
  assert.equal((await call([{ jsonrpc: "2.0", id: 1, method: "ping" }])).out.status, 400);
  assert.equal((await call({ id: 1, method: "ping" })).out.status, 400);
  assert.equal((await call({ jsonrpc: "2.0", id: { x: 1 }, method: "ping" })).out.status, 400);
  assert.equal((await call({ jsonrpc: "2.0", id: 1, method: "resources/list" })).body.error.code, -32601);
});

test("tools/list marks every tool read-only", async () => {
  const { body } = await call({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.equal(body.result.tools[0].annotations.readOnlyHint, true);
  assert.equal(body.result.tools[0].annotations.destructiveHint, false);
});

test("arguments are checked before the tool runs", async () => {
  for (const args of [{}, { text: "toolong" }, { text: "a", extra: 1 }, { text: "a", n: 4 }, { text: "a", n: 1.5 }, { text: "a", s: "c" }, []]) {
    const { body, log } = await call({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "echo", arguments: args } });
    assert.equal(body.result.isError, true, JSON.stringify(args));
    assert.equal(log[0].ok, false);
  }
  const { body, log } = await call({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "echo", arguments: { text: "hi", n: 2 } } });
  assert.equal(body.result.isError, false);
  assert.deepEqual(body.result.structuredContent, { got: { text: "hi", n: 2 } });
  assert.equal(log[0].ok, true);
  assert.deepEqual(log[0].args, { text: "hi", n: 2 });
});

test("internal errors stay internal; tool errors are shown", async () => {
  const boom = await call({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "echo", arguments: { text: "boom" } } });
  assert.doesNotMatch(boom.body.result.content[0].text, /secret internal/);
  assert.match(boom.log[0].detail, /secret internal/);
  const nope = await call({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "echo", arguments: { text: "nope" } } });
  assert.equal(nope.body.result.content[0].text, "No job with that id.");
});

test("an unknown tool is an error and is logged", async () => {
  const { body, log } = await call({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "delete_everything" } });
  assert.equal(body.error.code, -32602);
  assert.equal(log[0].tool, "delete_everything");
});

test("checkArgs treats missing arguments as empty", () => {
  assert.deepEqual(checkArgs({ type: "object", properties: {}, additionalProperties: false }, undefined), { ok: true, args: {} });
});
