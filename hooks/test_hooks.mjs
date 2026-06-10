#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = dirname(fileURLToPath(import.meta.url));
const CLI = join(ROOT, "note_distill_hook.ts");
const VALIDATE = join(
  ROOT,
  "..",
  "skills",
  "note",
  "scripts",
  "validate-note.ts"
);
const WRAPPER = join(ROOT, "run-hook.cmd");
// topic-info not needed in hook tests

function run(command, { input, env, cwd } = {}) {
  const result = spawnSync(command[0], command.slice(1), {
    input,
    encoding: "utf8",
    env: env ? { ...process.env, ...env } : process.env,
    cwd: cwd || undefined,
  });
  if (result.status !== 0) {
    throw new Error(
      `Command failed: ${command.join(" ")}\nSTDOUT:\n${
        result.stdout
      }\nSTDERR:\n${result.stderr}`
    );
  }
  return result;
}

function nodeCli(...args) {
  return [process.execPath, "--experimental-strip-types", CLI, ...args];
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function writeJsonl(path, records) {
  writeFileSync(
    path,
    records.map((record) => JSON.stringify(record)).join("\n") + "\n",
    "utf8"
  );
}

function tempDir() {
  return mkdtempSync(join(tmpdir(), "note-distill-test-"));
}

function heuristicConfigEnv(dir) {
  const configPath = join(dir, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      candidate_analyzer: {
        provider: "heuristic",
        model: "",
        fallback: "heuristic",
      },
    }),
    "utf8"
  );
  return { NOTE_DISTILL_CONFIG: configPath };
}

async function waitForJsonl(path) {
  for (let i = 0; i < 50; i += 1) {
    const records = readJsonl(path);
    if (records.length) return records;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return readJsonl(path);
}

function testCollectorSkipsWhenAnalyzerChild() {
  // When NOTE_DISTILL_ANALYZER_CHILD=1, the collector should skip all work
  // (anti-recursion guard) but still return the standard hook response.
  const dir = tempDir();
  const result = run(nodeCli("collect"), {
    env: {
      NOTE_DISTILL_DATA_DIR: dir,
      NOTE_DISTILL_ANALYZER_CHILD: "1",
    },
    input: JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      session_id: "child-guard-test",
      cwd: "/tmp",
      transcript_path: "/tmp/transcript.jsonl",
      prompt: "this should be skipped",
    }),
  });
  // Hook response is normal
  assert.equal(JSON.parse(result.stdout).continue, true);
  // No events.jsonl written
  assert.equal(
    existsSync(join(dir, "sessions", "child-guard-test", "events.jsonl")),
    false
  );
}

function testAnalyzerDisabledSkipsCandidateExtraction() {
  // When candidate_analyzer.enabled=false, analyze command should produce
  // zero candidates regardless of event content.
  const dir = tempDir();
  const eventsPath = join(dir, "events.jsonl");
  const candidatesPath = join(dir, "note_candidates.jsonl");
  const configPath = join(dir, "config.json");
  writeJsonl(eventsPath, [
    {
      event: "UserPromptSubmit",
      session_id: "disabled-test",
      transcript_path: "/tmp/transcript.jsonl",
      payload: { prompt: "这个方案应该用 hook 采集事件窗口" },
    },
    {
      event: "Stop",
      session_id: "disabled-test",
      transcript_path: "/tmp/transcript.jsonl",
      payload: { last_assistant_message: "方案：用 hooks 写 events.jsonl。" },
    },
  ]);
  writeFileSync(
    configPath,
    JSON.stringify({
      candidate_analyzer: {
        enabled: false,
        provider: "heuristic",
        model: "",
        fallback: "heuristic",
      },
    }),
    "utf8"
  );
  const analyzeResult = JSON.parse(
    run(nodeCli("analyze", eventsPath, "--output", candidatesPath), {
      env: { NOTE_DISTILL_CONFIG: configPath },
    }).stdout
  );
  assert.equal(analyzeResult.skipped, "disabled");
  assert.equal(analyzeResult.candidates, 0);
  // No candidates file written
  assert.equal(existsSync(candidatesPath), false);
}

function testAnalyzerDisabledViaEnvVar() {
  const dir = tempDir();
  const eventsPath = join(dir, "events.jsonl");
  const candidatesPath = join(dir, "note_candidates.jsonl");
  const configPath = join(dir, "config.json");
  writeJsonl(eventsPath, [
    {
      event: "UserPromptSubmit",
      session_id: "env-disable-test",
      transcript_path: "/tmp/transcript.jsonl",
      payload: { prompt: "这个方案应该用 hook 采集事件窗口" },
    },
    {
      event: "Stop",
      session_id: "env-disable-test",
      transcript_path: "/tmp/transcript.jsonl",
      payload: { last_assistant_message: "方案：用 hooks 写 events.jsonl。" },
    },
  ]);
  // Config has enabled=true (default), but env var overrides it
  writeFileSync(
    configPath,
    JSON.stringify({
      candidate_analyzer: {
        provider: "heuristic",
        model: "",
        fallback: "heuristic",
      },
    }),
    "utf8"
  );
  const analyzeResult = JSON.parse(
    run(nodeCli("analyze", eventsPath, "--output", candidatesPath), {
      env: {
        NOTE_DISTILL_CONFIG: configPath,
        NOTE_DISTILL_ANALYZER_ENABLED: "false",
      },
    }).stdout
  );
  assert.equal(analyzeResult.skipped, "disabled");
  assert.equal(analyzeResult.candidates, 0);
}

async function testCollectorRecordsAndRedacts() {
  const dir = tempDir();
  run(nodeCli("collect"), {
    env: { NOTE_DISTILL_DATA_DIR: dir },
    input: JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      session_id: "redact-test",
      cwd: "/tmp",
      transcript_path: "/tmp/transcript.jsonl",
      prompt: "token=abc123 password: secret Authorization: Bearer xyz",
    }),
  });
  const records = readJsonl(
    join(dir, "sessions", "redact-test", "events.jsonl")
  );
  assert.equal(records.length, 1);
  const prompt = records[0].payload.prompt;
  assert.equal(prompt.includes("abc123"), false);
  assert.equal(prompt.includes("secret"), false);
  assert.equal(prompt.includes("xyz"), false);
  assert.equal(prompt.includes("[REDACTED]"), true);
}

function testCollectorFailOpenOnBadJson() {
  const dir = tempDir();
  const result = run(nodeCli("collect"), {
    env: { NOTE_DISTILL_DATA_DIR: dir },
    input: "not-json",
  });
  assert.equal(JSON.parse(result.stdout).continue, true);
  assert.equal(
    existsSync(join(dir, "logs", "session-collector-error.log")),
    true
  );
}

async function testWrapperInvokesCollectorAndAnalyzer() {
  const dir = tempDir();
  run(["bash", WRAPPER, "note_distill_hook.ts", "collect"], {
    env: { NOTE_DISTILL_DATA_DIR: dir, ...heuristicConfigEnv(dir) },
    input: JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      session_id: "wrapper-flow",
      cwd: "/tmp",
      transcript_path: "/tmp/transcript.jsonl",
      prompt: "这个方案应该用 hook 采集事件窗口",
    }),
  });
  run(["bash", WRAPPER, "note_distill_hook.ts", "collect"], {
    env: { NOTE_DISTILL_DATA_DIR: dir, ...heuristicConfigEnv(dir) },
    input: JSON.stringify({
      hook_event_name: "Stop",
      session_id: "wrapper-flow",
      cwd: "/tmp",
      transcript_path: "/tmp/transcript.jsonl",
      last_assistant_message: "方案：Stop 后异步生成 note candidates。",
    }),
  });
  const sessionDir = join(dir, "sessions", "wrapper-flow");
  assert.deepEqual(
    readJsonl(join(sessionDir, "events.jsonl")).map((record) => record.event),
    ["UserPromptSubmit", "Stop"]
  );
  const candidates = await waitForJsonl(
    join(sessionDir, "note_candidates.jsonl")
  );
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].status, "pending");
}

function testModelJsonParserFixture() {
  const dir = tempDir();
  const modelOutput = join(dir, "model-output.json");
  const eventsPath = join(dir, "events.jsonl");
  writeJsonl(eventsPath, [
    {
      event: "UserPromptSubmit",
      session_id: "model-test",
      payload: { prompt: "讨论 source_refs" },
    },
    {
      event: "Stop",
      session_id: "model-test",
      payload: { last_assistant_message: "结论：按 range 补上下文。" },
    },
  ]);
  writeFileSync(
    modelOutput,
    JSON.stringify({
      candidates: [
        {
          type: "architecture",
          title: "source_refs 补上下文",
          summary: "按 candidate source_refs 读取局部上下文。",
          claim: "source_refs 让 /note 不需要读完整会话。",
          why: "降低上下文成本。",
          confidence: "high",
          event_range: { start_index: 0, end_index: 1 },
        },
      ],
    }),
    "utf8"
  );
  const parsed = JSON.parse(
    run(
      nodeCli(
        "parse-model-output",
        modelOutput,
        "--events",
        eventsPath,
        "--provider",
        "fake-model"
      )
    ).stdout
  );
  assert.equal(parsed.candidates.length, 1);
  assert.equal(parsed.candidates[0].type, "architecture");
  assert.equal(parsed.candidates[0].analyzer.provider, "fake-model");
  assert.equal(parsed.candidates[0].source_refs[0].path, eventsPath);
}

function testParseModelOutputRepairsTruncatedJson() {
  const dir = tempDir();
  const eventsPath = join(dir, "events.jsonl");
  writeJsonl(eventsPath, [
    {
      event: "UserPromptSubmit",
      session_id: "trunc-test",
      payload: { prompt: "讨论架构" },
    },
    {
      event: "Stop",
      session_id: "trunc-test",
      payload: { last_assistant_message: "结论" },
    },
  ]);
  // Simulate truncated JSON: missing closing brackets
  const truncated =
    '{"candidates":[{"type":"architecture","title":"微服务拆分","summary":"按领域拆分服务","claim":"降低耦合","why":"独立部署","confidence":"high","event_range":{"start_index":0,"end_index":1}';
  const modelOutput = join(dir, "model-output.json");
  writeFileSync(modelOutput, truncated, "utf8");
  const parsed = JSON.parse(
    run(nodeCli("parse-model-output", modelOutput, "--events", eventsPath))
      .stdout
  );
  assert.equal(parsed.repaired, true);
  assert.equal(parsed.candidates.length, 1);
  assert.equal(parsed.candidates[0].type, "architecture");
  assert.equal(parsed.candidates[0].analyzer.repaired, undefined);
}

function testParseModelOutputNoRepairOnValidJson() {
  const dir = tempDir();
  const eventsPath = join(dir, "events.jsonl");
  writeJsonl(eventsPath, [
    {
      event: "UserPromptSubmit",
      session_id: "valid-test",
      payload: { prompt: "讨论方案" },
    },
    {
      event: "Stop",
      session_id: "valid-test",
      payload: { last_assistant_message: "结论" },
    },
  ]);
  const modelOutput = join(dir, "model-output.json");
  writeFileSync(
    modelOutput,
    JSON.stringify({
      candidates: [
        {
          type: "decision",
          title: "选择方案A",
          summary: "方案A更适合",
          claim: "更灵活",
          why: "可扩展",
          confidence: "medium",
          event_range: { start_index: 0, end_index: 1 },
        },
      ],
    }),
    "utf8"
  );
  const parsed = JSON.parse(
    run(nodeCli("parse-model-output", modelOutput, "--events", eventsPath))
      .stdout
  );
  assert.equal(parsed.repaired, false);
  assert.equal(parsed.candidates.length, 1);
}

function testParseModelOutputStripsMarkdownCodeBlock() {
  const dir = tempDir();
  const eventsPath = join(dir, "events.jsonl");
  writeJsonl(eventsPath, [
    {
      event: "UserPromptSubmit",
      session_id: "md-test",
      payload: { prompt: "讨论修复" },
    },
    {
      event: "Stop",
      session_id: "md-test",
      payload: { last_assistant_message: "结论" },
    },
  ]);
  const wrapped =
    'Here is the analysis:\n```json\n{"candidates":[{"type":"bugfix","title":"修复空指针","summary":"加了null检查","claim":"不再崩溃","why":"用户反馈","confidence":"high","event_range":{"start_index":0,"end_index":1}}]}\n```\nDone.';
  const modelOutput = join(dir, "model-output.json");
  writeFileSync(modelOutput, wrapped, "utf8");
  const parsed = JSON.parse(
    run(nodeCli("parse-model-output", modelOutput, "--events", eventsPath))
      .stdout
  );
  assert.equal(parsed.candidates.length, 1);
  assert.equal(parsed.candidates[0].type, "bugfix");
  assert.equal(parsed.repaired, false);
}

function testFakeAnalyzerProvider() {
  const dir = tempDir();
  const configPath = join(dir, "config.json");
  const eventsPath = join(dir, "events.jsonl");
  const candidatesPath = join(dir, "note_candidates.jsonl");
  writeFileSync(
    configPath,
    JSON.stringify({
      candidate_analyzer: {
        provider: "fake",
        model: "fake",
        fallback: "heuristic",
      },
    }),
    "utf8"
  );
  writeJsonl(eventsPath, [
    {
      event: "UserPromptSubmit",
      session_id: "fake-test",
      payload: { prompt: "普通但用户想测试 fake analyzer" },
    },
    {
      event: "Stop",
      session_id: "fake-test",
      payload: { last_assistant_message: "fake analyzer 应该生成候选。" },
    },
  ]);
  run(nodeCli("analyze", eventsPath, "--output", candidatesPath), {
    env: { NOTE_DISTILL_CONFIG: configPath },
  });
  const candidates = readJsonl(candidatesPath);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].analyzer.provider, "fake");
  assert.equal(candidates[0].type, "decision");
}

function testClaudeAnalyzerFallsBackToHeuristic() {
  const dir = tempDir();
  const configPath = join(dir, "config.json");
  const eventsPath = join(dir, "events.jsonl");
  const candidatesPath = join(dir, "note_candidates.jsonl");
  writeFileSync(
    configPath,
    JSON.stringify({
      candidate_analyzer: {
        provider: "claude",
        model: "haiku",
        fallback: "heuristic",
      },
    }),
    "utf8"
  );
  writeJsonl(eventsPath, [
    {
      event: "UserPromptSubmit",
      session_id: "claude-test",
      payload: { prompt: "这个方案应该 fallback 到 heuristic" },
    },
    {
      event: "Stop",
      session_id: "claude-test",
      payload: { last_assistant_message: "fallback 仍然生成候选。" },
    },
  ]);
  run(nodeCli("analyze", eventsPath, "--output", candidatesPath), {
    env: { NOTE_DISTILL_CONFIG: configPath, PATH: "/nonexistent" },
  });
  const candidates = readJsonl(candidatesPath);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].analyzer.provider, "heuristic");
  assert.equal(candidates[0].analyzer.fallback_from, "claude");
  assert.ok(
    ["claude_not_found", "claude_failed"].includes(
      candidates[0].analyzer.reason
    )
  );
}

function testClaudeAnalyzerFallbackNoneReturnsEmpty() {
  const dir = tempDir();
  const configPath = join(dir, "config.json");
  const eventsPath = join(dir, "events.jsonl");
  const candidatesPath = join(dir, "note_candidates.jsonl");
  writeFileSync(
    configPath,
    JSON.stringify({
      candidate_analyzer: {
        provider: "claude",
        model: "haiku",
        fallback: "none",
      },
    }),
    "utf8"
  );
  writeJsonl(eventsPath, [
    {
      event: "UserPromptSubmit",
      session_id: "none-test",
      payload: { prompt: "这个方案应该 fallback 到 none" },
    },
    {
      event: "Stop",
      session_id: "none-test",
      payload: { last_assistant_message: "fallback=none 不应生成候选。" },
    },
  ]);
  run(nodeCli("analyze", eventsPath, "--output", candidatesPath), {
    env: { NOTE_DISTILL_CONFIG: configPath, PATH: "/nonexistent" },
  });
  const candidates = readJsonl(candidatesPath);
  assert.deepEqual(candidates, []);
}

function testAnalyzerLockSkipsWhenFreshLockExists() {
  const dir = tempDir();
  const eventsPath = join(dir, "events.jsonl");
  const candidatesPath = join(dir, "note_candidates.jsonl");
  const lockPath = join(dir, "note_candidates.jsonl.lock");
  writeJsonl(eventsPath, [
    {
      event: "UserPromptSubmit",
      session_id: "lock-test",
      payload: { prompt: "方案讨论" },
    },
    {
      event: "Stop",
      session_id: "lock-test",
      payload: { last_assistant_message: "方案结论。" },
    },
  ]);
  writeFileSync(lockPath, String(Date.now()), "utf8");
  const result = JSON.parse(
    run(nodeCli("analyze", eventsPath, "--output", candidatesPath), {
      env: heuristicConfigEnv(dir),
      cwd: dir,
    }).stdout
  );
  assert.equal(result.skipped, "locked");
}

function testAnalyzerBreaksStaleLockAndProceeds() {
  const dir = tempDir();
  const eventsPath = join(dir, "events.jsonl");
  const candidatesPath = join(dir, "note_candidates.jsonl");
  const lockPath = join(dir, "note_candidates.jsonl.lock");
  writeJsonl(eventsPath, [
    {
      event: "UserPromptSubmit",
      session_id: "stale-test",
      payload: { prompt: "方案讨论" },
    },
    {
      event: "Stop",
      session_id: "stale-test",
      payload: { last_assistant_message: "方案结论。" },
    },
  ]);
  writeFileSync(lockPath, String(Date.now() - 120_000), "utf8");
  const result = JSON.parse(
    run(nodeCli("analyze", eventsPath, "--output", candidatesPath), {
      env: heuristicConfigEnv(dir),
      cwd: dir,
    }).stdout
  );
  assert.ok(result.candidates > 0);
  assert.ok(!existsSync(lockPath));
}

function testCollectorRedactsSecretKey() {
  const dir = tempDir();
  run(nodeCli("collect"), {
    env: { NOTE_DISTILL_DATA_DIR: dir },
    input: JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      session_id: "secret-key-test",
      cwd: "/tmp",
      transcript_path: "/tmp/transcript.jsonl",
      prompt: "SECRET_KEY=dontleakthis GITHUB_TOKEN=ghp_xxx PASSWORD: hunter2",
    }),
  });
  const records = readJsonl(
    join(dir, "sessions", "secret-key-test", "events.jsonl")
  );
  assert.equal(records.length, 1);
  const prompt = records[0].payload.prompt;
  assert.equal(prompt.includes("dontleakthis"), false);
  assert.equal(prompt.includes("[REDACTED]"), true);
}

// ---- validate-note.ts tests ----

function makeSimpleNote(frontmatter, body) {
  return `---\n${Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n")}\n---\n\n${body}`;
}

function makeTemplate(frontmatter, body) {
  return `---\n${Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n")}\n---\n\n${body}`;
}

const tests = [
  testCollectorSkipsWhenAnalyzerChild,
  testAnalyzerDisabledSkipsCandidateExtraction,
  testAnalyzerDisabledViaEnvVar,
  testCollectorRecordsAndRedacts,
  testCollectorFailOpenOnBadJson,
  testWrapperInvokesCollectorAndAnalyzer,
  testModelJsonParserFixture,
  testParseModelOutputRepairsTruncatedJson,
  testParseModelOutputNoRepairOnValidJson,
  testParseModelOutputStripsMarkdownCodeBlock,
  testFakeAnalyzerProvider,
  testClaudeAnalyzerFallsBackToHeuristic,
  testClaudeAnalyzerFallbackNoneReturnsEmpty,
  testAnalyzerLockSkipsWhenFreshLockExists,
  testAnalyzerBreaksStaleLockAndProceeds,
  testCollectorRedactsSecretKey,
];

for (const test of tests) {
  await test();
  console.log(`PASS ${test.name}`);
}
