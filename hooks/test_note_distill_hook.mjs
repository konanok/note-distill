#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = dirname(fileURLToPath(import.meta.url));
const CLI = join(ROOT, "note_distill_hook.ts");
const VALIDATE = join(ROOT, "validate-note.ts");
const WRAPPER = join(ROOT, "run-hook.cmd");

function run(command, { input, env, cwd } = {}) {
  const result = spawnSync(command[0], command.slice(1), {
    input,
    encoding: "utf8",
    env: env ? { ...process.env, ...env } : process.env,
    cwd: cwd || undefined,
  });
  if (result.status !== 0) {
    throw new Error(
      `Command failed: ${command.join(" ")}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
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
    "utf8",
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
    "utf8",
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
    join(dir, "sessions", "redact-test", "events.jsonl"),
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
    true,
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
    ["UserPromptSubmit", "Stop"],
  );
  const candidates = await waitForJsonl(
    join(sessionDir, "note_candidates.jsonl"),
  );
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].status, "pending");
}

function testExtractNoteWindow() {
  const dir = tempDir();
  const eventsPath = join(dir, "events.jsonl");
  writeJsonl(eventsPath, [
    {
      event: "UserPromptSubmit",
      payload: { prompt: "如何在 git 里压缩最近 3 个 commit？" },
    },
    {
      event: "UserPromptSubmit",
      payload: { prompt: "/note quick git squash" },
    },
    { event: "UserPromptSubmit", payload: { prompt: "新的技术讨论" } },
    {
      event: "Stop",
      payload: { last_assistant_message: "这是新讨论的解决方案。" },
    },
    {
      event: "UserPromptSubmit",
      payload: { prompt: "/note deep note incremental scope" },
    },
  ]);
  const result = JSON.parse(run(nodeCli("window", eventsPath)).stdout);
  assert.equal(result.previous_note.prompt, "/note quick git squash");
  assert.equal(result.current_note.prompt, "/note deep note incremental scope");
  assert.deepEqual(
    result.events
      .filter((event) => event.event === "UserPromptSubmit")
      .map((event) => event.payload.prompt),
    ["新的技术讨论"],
  );
}

function testAnalyzerAndCandidateExtraction() {
  const dir = tempDir();
  const eventsPath = join(dir, "events.jsonl");
  const candidatesPath = join(dir, "note_candidates.jsonl");
  writeJsonl(eventsPath, [
    {
      event: "UserPromptSubmit",
      session_id: "candidate-test",
      transcript_path: "/tmp/transcript.jsonl",
      payload: { prompt: "/note quick 方案总结" },
    },
    {
      event: "UserPromptSubmit",
      session_id: "candidate-test",
      transcript_path: "/tmp/transcript.jsonl",
      payload: { prompt: "这个方案应该用 hook 采集事件窗口" },
    },
    {
      event: "Stop",
      session_id: "candidate-test",
      transcript_path: "/tmp/transcript.jsonl",
      payload: { last_assistant_message: "方案：用 hooks 写 events.jsonl。" },
    },
  ]);
  run(nodeCli("analyze", eventsPath, "--output", candidatesPath), {
    env: heuristicConfigEnv(dir),
  });
  const candidates = readJsonl(candidatesPath);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].type, "decision");
  assert.deepEqual(candidates[0].source_refs, [
    {
      kind: "event_range",
      path: eventsPath,
      start_index: 1,
      end_index: 2,
      transcript_path: "/tmp/transcript.jsonl",
    },
  ]);
  const extracted = JSON.parse(
    run(nodeCli("candidates", candidatesPath)).stdout,
  );
  assert.deepEqual(extracted.selected_candidate_ids, [
    candidates[0].candidate_id,
  ]);
}

function testContextReadsCandidateSourceRefs() {
  const dir = tempDir();
  const eventsPath = join(dir, "events.jsonl");
  const candidatePath = join(dir, "candidate.json");
  writeJsonl(eventsPath, [
    { event: "UserPromptSubmit", payload: { prompt: "旧讨论" } },
    {
      event: "UserPromptSubmit",
      payload: { prompt: "这个方案应该用 source_refs 补上下文" },
    },
    {
      event: "Stop",
      payload: {
        last_assistant_message:
          "方案：按 candidate source_refs 读取局部上下文。",
      },
    },
    { event: "UserPromptSubmit", payload: { prompt: "后续话题" } },
  ]);
  writeFileSync(
    candidatePath,
    JSON.stringify({
      candidate_id: "source-ref",
      source_refs: [
        { kind: "event_range", path: eventsPath, start_index: 1, end_index: 2 },
      ],
    }),
    "utf8",
  );
  const context = JSON.parse(run(nodeCli("context", candidatePath)).stdout);
  assert.equal(context.contexts.length, 1);
  assert.deepEqual(
    context.contexts[0].events.map(
      (event) => event.payload.prompt || event.payload.last_assistant_message,
    ),
    [
      "这个方案应该用 source_refs 补上下文",
      "方案：按 candidate source_refs 读取局部上下文。",
    ],
  );
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
    "utf8",
  );
  const parsed = JSON.parse(
    run(
      nodeCli(
        "parse-model-output",
        modelOutput,
        "--events",
        eventsPath,
        "--provider",
        "fake-model",
      ),
    ).stdout,
  );
  assert.equal(parsed.candidates.length, 1);
  assert.equal(parsed.candidates[0].type, "architecture");
  assert.equal(parsed.candidates[0].analyzer.provider, "fake-model");
  assert.equal(parsed.candidates[0].source_refs[0].path, eventsPath);
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
    "utf8",
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
    "utf8",
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
      candidates[0].analyzer.reason,
    ),
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
    "utf8",
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

function testMultiStopPreservesConsumedStatus() {
  const dir = tempDir();
  const configPath = join(dir, "config.json");
  const eventsPath = join(dir, "events.jsonl");
  const candidatesPath = join(dir, "note_candidates.jsonl");
  writeFileSync(
    configPath,
    JSON.stringify({
      candidate_analyzer: {
        provider: "heuristic",
        model: "",
        fallback: "heuristic",
      },
    }),
    "utf8",
  );
  // First analysis: UserPrompt A → Stop A triggers analyze, produces candidate A
  writeJsonl(eventsPath, [
    {
      event: "UserPromptSubmit",
      session_id: "multi-stop",
      transcript_path: "/tmp/transcript.jsonl",
      payload: { prompt: "这个方案应该用 hook 采集事件窗口" },
    },
    {
      event: "Stop",
      session_id: "multi-stop",
      transcript_path: "/tmp/transcript.jsonl",
      payload: { last_assistant_message: "方案：用 hooks 写 events.jsonl。" },
    },
  ]);
  run(nodeCli("analyze", eventsPath, "--output", candidatesPath), {
    env: { NOTE_DISTILL_CONFIG: configPath },
  });
  const firstRun = readJsonl(candidatesPath);
  assert.equal(firstRun.length, 1);
  assert.equal(firstRun[0].status, "pending");
  const candId = firstRun[0].candidate_id;
  // Mark consumed
  run(
    nodeCli(
      "mark-consumed",
      candidatesPath,
      "--ids",
      candId,
      "--note-path",
      "/tmp/note.md",
    ),
  );
  const afterMark = readJsonl(candidatesPath);
  assert.equal(afterMark[0].status, "consumed");
  assert.equal(afterMark[0].note_path, "/tmp/note.md");
  // Second analysis: new events trigger re-analysis, should preserve consumed status
  writeJsonl(eventsPath, [
    {
      event: "UserPromptSubmit",
      session_id: "multi-stop",
      transcript_path: "/tmp/transcript.jsonl",
      payload: { prompt: "这个方案应该用 hook 采集事件窗口" },
    },
    {
      event: "Stop",
      session_id: "multi-stop",
      transcript_path: "/tmp/transcript.jsonl",
      payload: { last_assistant_message: "方案：用 hooks 写 events.jsonl。" },
    },
    {
      event: "UserPromptSubmit",
      session_id: "multi-stop",
      transcript_path: "/tmp/transcript.jsonl",
      payload: { prompt: "另一个架构讨论" },
    },
    {
      event: "Stop",
      session_id: "multi-stop",
      transcript_path: "/tmp/transcript.jsonl",
      payload: { last_assistant_message: "这是另一个架构讨论的结果。" },
    },
  ]);
  run(nodeCli("analyze", eventsPath, "--output", candidatesPath), {
    env: { NOTE_DISTILL_CONFIG: configPath },
  });
  const secondRun = readJsonl(candidatesPath);
  // Two candidates: original A (should be consumed) + new B (should be pending)
  assert.equal(secondRun.length, 2);
  const consumedCand = secondRun.find((c) => c.candidate_id === candId);
  const newCand = secondRun.find((c) => c.candidate_id !== candId);
  assert.equal(consumedCand.status, "consumed");
  assert.equal(consumedCand.consumed_at, afterMark[0].consumed_at);
  assert.equal(consumedCand.note_path, "/tmp/note.md");
  assert.equal(newCand.status, "pending");
}

function testCandidateExtractionFiltersByTopic() {
  const dir = tempDir();
  const candidatesPath = join(dir, "note_candidates.jsonl");
  writeJsonl(candidatesPath, [
    {
      candidate_id: "jsonl",
      status: "pending",
      title: "JSONL 取舍",
      summary: "讨论自己写 JSONL 与读取 Claude transcript 的取舍",
      evidence: ["JSONL 取舍"],
    },
    {
      candidate_id: "hook",
      status: "pending",
      title: "hook worker",
      summary: "hook worker 架构",
      evidence: ["hooks"],
    },
  ]);
  const extracted = JSON.parse(
    run(nodeCli("candidates", candidatesPath, "--topic", "JSONL 取舍")).stdout,
  );
  assert.equal(extracted.topic_matched, true);
  assert.deepEqual(extracted.selected_candidate_ids, ["jsonl"]);
}

function testCandidateExtractionReportsTopicMiss() {
  const dir = tempDir();
  const candidatesPath = join(dir, "note_candidates.jsonl");
  writeJsonl(candidatesPath, [
    {
      candidate_id: "hook",
      status: "pending",
      title: "hook worker",
      summary: "hook worker 架构",
    },
  ]);
  const extracted = JSON.parse(
    run(nodeCli("candidates", candidatesPath, "--topic", "JSONL 取舍")).stdout,
  );
  assert.equal(extracted.topic_matched, false);
  assert.equal(extracted.should_check_event_window, true);
  assert.deepEqual(extracted.candidates, []);
}

function testCandidateExtractionFiltersToCurrentNoteWindow() {
  const dir = tempDir();
  const eventsPath = join(dir, "events.jsonl");
  const candidatesPath = join(dir, "note_candidates.jsonl");
  writeJsonl(eventsPath, [
    { event: "UserPromptSubmit", payload: { prompt: "旧方案讨论" } },
    { event: "UserPromptSubmit", payload: { prompt: "/note quick old" } },
    { event: "UserPromptSubmit", payload: { prompt: "新方案讨论" } },
    { event: "UserPromptSubmit", payload: { prompt: "/note deep new" } },
  ]);
  writeJsonl(candidatesPath, [
    {
      candidate_id: "old",
      status: "pending",
      range: { prompt_event_index: 0 },
      title: "旧方案",
    },
    {
      candidate_id: "new",
      status: "pending",
      range: { prompt_event_index: 2 },
      title: "新方案",
    },
    {
      candidate_id: "used",
      status: "consumed",
      range: { prompt_event_index: 2 },
      title: "已用方案",
    },
  ]);
  const extracted = JSON.parse(
    run(nodeCli("candidates", candidatesPath, "--events", eventsPath)).stdout,
  );
  assert.equal(extracted.previous_note_index, 1);
  assert.equal(extracted.current_note_index, 3);
  assert.deepEqual(extracted.selected_candidate_ids, ["new"]);
}

function testCandidateSelectionModes() {
  const dir = tempDir();
  const candidatesPath = join(dir, "note_candidates.jsonl");
  writeJsonl(candidatesPath, [
    {
      candidate_id: "first",
      status: "pending",
      type: "command",
      range: { prompt_event_index: 1 },
      title: "first",
    },
    {
      candidate_id: "second",
      status: "pending",
      type: "bugfix",
      range: { prompt_event_index: 2 },
      title: "second",
    },
    {
      candidate_id: "third",
      status: "pending",
      type: "decision",
      range: { prompt_event_index: 3 },
      title: "third",
    },
  ]);
  assert.deepEqual(
    JSON.parse(
      run(
        nodeCli(
          "candidates",
          candidatesPath,
          "--selection",
          "auto",
          "--strategy",
          "oldest",
        ),
      ).stdout,
    ).selected_candidate_ids,
    ["first"],
  );
  assert.deepEqual(
    JSON.parse(
      run(
        nodeCli(
          "candidates",
          candidatesPath,
          "--selection",
          "auto",
          "--strategy",
          "newest",
        ),
      ).stdout,
    ).selected_candidate_ids,
    ["third"],
  );
  assert.deepEqual(
    JSON.parse(
      run(
        nodeCli(
          "candidates",
          candidatesPath,
          "--selection",
          "auto",
          "--strategy",
          "priority",
        ),
      ).stdout,
    ).selected_candidate_ids,
    ["second"],
  );
  const pick = JSON.parse(
    run(
      nodeCli(
        "candidates",
        candidatesPath,
        "--selection",
        "pick",
        "--max-options",
        "2",
      ),
    ).stdout,
  );
  assert.deepEqual(pick.candidates, []);
  assert.deepEqual(
    pick.pick_options.map((option) => option.candidate_id),
    ["first", "second"],
  );
  const all = JSON.parse(
    run(nodeCli("candidates", candidatesPath, "--selection", "all")).stdout,
  );
  assert.equal(all.experimental, true);
  assert.deepEqual(all.selected_candidate_ids, ["first", "second", "third"]);
}

function testMarkCandidatesConsumed() {
  const dir = tempDir();
  const candidatesPath = join(dir, "note_candidates.jsonl");
  writeJsonl(candidatesPath, [
    { candidate_id: "a", status: "pending", title: "A" },
    { candidate_id: "b", status: "pending", title: "B" },
  ]);
  run(
    nodeCli(
      "mark-consumed",
      candidatesPath,
      "--ids",
      "a",
      "--note-path",
      "/tmp/note.md",
    ),
  );
  const records = readJsonl(candidatesPath);
  assert.equal(records[0].status, "consumed");
  assert.equal(records[0].note_path, "/tmp/note.md");
  assert.ok(records[0].consumed_at);
  assert.equal(records[1].status, "pending");
}

function testAnalyzePreservesPendingOnRerun() {
  const dir = tempDir();
  const configPath = join(dir, "config.json");
  const eventsPath = join(dir, "events.jsonl");
  const candidatesPath = join(dir, "note_candidates.jsonl");
  writeFileSync(
    configPath,
    JSON.stringify({
      candidate_analyzer: {
        provider: "heuristic",
        model: "",
        fallback: "heuristic",
      },
    }),
    "utf8",
  );
  writeJsonl(eventsPath, [
    {
      event: "UserPromptSubmit",
      session_id: "rerun-test",
      transcript_path: "/tmp/transcript.jsonl",
      payload: { prompt: "这个方案应该用 hook 采集事件窗口" },
    },
    {
      event: "Stop",
      session_id: "rerun-test",
      transcript_path: "/tmp/transcript.jsonl",
      payload: { last_assistant_message: "方案：用 hooks 写 events.jsonl。" },
    },
  ]);
  run(nodeCli("analyze", eventsPath, "--output", candidatesPath), {
    env: { NOTE_DISTILL_CONFIG: configPath },
  });
  const firstRun = readJsonl(candidatesPath);
  assert.equal(firstRun.length, 1);
  assert.equal(firstRun[0].status, "pending");
  const candId = firstRun[0].candidate_id;
  writeJsonl(eventsPath, [
    {
      event: "UserPromptSubmit",
      session_id: "rerun-test",
      transcript_path: "/tmp/transcript.jsonl",
      payload: { prompt: "hello world" },
    },
    {
      event: "Stop",
      session_id: "rerun-test",
      transcript_path: "/tmp/transcript.jsonl",
      payload: { last_assistant_message: "hi there" },
    },
  ]);
  run(nodeCli("analyze", eventsPath, "--output", candidatesPath), {
    env: { NOTE_DISTILL_CONFIG: configPath },
  });
  const secondRun = readJsonl(candidatesPath);
  assert.equal(secondRun.length, 1);
  assert.equal(secondRun[0].candidate_id, candId);
  assert.equal(secondRun[0].status, "pending");
}

function testProjectConfigOverridesGlobal() {
  const dir = tempDir();
  const globalConfigPath = join(dir, "global-config.json");
  const projectConfigPath = join(dir, ".note-distill.json");
  const eventsPath = join(dir, "events.jsonl");
  const candidatesPath = join(dir, "note_candidates.jsonl");
  writeFileSync(
    globalConfigPath,
    JSON.stringify({
      candidate_analyzer: {
        provider: "heuristic",
        model: "",
        fallback: "heuristic",
      },
    }),
    "utf8",
  );
  writeFileSync(
    projectConfigPath,
    JSON.stringify({ candidate_analyzer: { provider: "fake", model: "fake" } }),
    "utf8",
  );
  writeJsonl(eventsPath, [
    {
      event: "UserPromptSubmit",
      session_id: "proj-test",
      payload: { prompt: "hello" },
    },
    {
      event: "Stop",
      session_id: "proj-test",
      payload: { last_assistant_message: "world" },
    },
  ]);
  run(nodeCli("analyze", eventsPath, "--output", candidatesPath), {
    env: { NOTE_DISTILL_CONFIG: globalConfigPath },
    cwd: dir,
  });
  const candidates = readJsonl(candidatesPath);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].analyzer.provider, "fake");
}

function testProjectConfigDeepMergesNestedObjects() {
  const dir = tempDir();
  const globalConfigPath = join(dir, "global-config.json");
  const projectConfigPath = join(dir, ".note-distill.json");
  writeFileSync(
    globalConfigPath,
    JSON.stringify({
      candidate_analyzer: {
        provider: "claude",
        model: "haiku",
        fallback: "heuristic",
      },
    }),
    "utf8",
  );
  writeFileSync(
    projectConfigPath,
    JSON.stringify({ candidate_analyzer: { provider: "fake" } }),
    "utf8",
  );
  const merged = JSON.parse(
    run(nodeCli("merge-config"), {
      env: { NOTE_DISTILL_CONFIG: globalConfigPath },
      cwd: dir,
    }).stdout,
  );
  assert.equal(merged.candidate_analyzer.provider, "fake");
  assert.equal(merged.candidate_analyzer.model, "haiku");
  assert.equal(merged.candidate_analyzer.fallback, "heuristic");
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
    }).stdout,
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
    }).stdout,
  );
  assert.ok(result.candidates > 0);
  assert.ok(!existsSync(lockPath));
}

function testMergeConfigCommand() {
  const dir = tempDir();
  const globalConfigPath = join(dir, "global-config.json");
  writeFileSync(
    globalConfigPath,
    JSON.stringify({
      adapter: "local-markdown",
      output_dir: "/tmp/global",
      default_style: "technical",
    }),
    "utf8",
  );
  const merged = JSON.parse(
    run(nodeCli("merge-config"), {
      env: { NOTE_DISTILL_CONFIG: globalConfigPath },
      cwd: dir,
    }).stdout,
  );
  assert.equal(merged.adapter, "local-markdown");
  assert.equal(merged.output_dir, "/tmp/global");
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
    join(dir, "sessions", "secret-key-test", "events.jsonl"),
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

async function testValidatePassesWithAllSections() {
  const tmp = mkdtempSync(join(tmpdir(), "nd-test-"));
  const tmplPath = join(tmp, "template.md");
  const notePath = join(tmp, "note.md");

  const template = makeTemplate(
    {
      title: "{{title}}",
      tags: "[{{domain_tags}}, ai-generated]",
      created: "{{date}}",
    },
    "# {{title}}\n\n## 场景\n\n测试场景内容\n\n## 方案\n\n测试方案内容\n\n## 备注\n\n可选备注",
  );
  const note = makeSimpleNote(
    {
      title: "测试笔记",
      tags: "git, cli, ai-generated",
      created: "2026-05-19",
    },
    "# 测试笔记\n\n## 场景\n\n测试场景内容\n\n## 方案\n\n测试方案内容\n\n## 备注\n\n可选备注",
  );

  writeFileSync(tmplPath, template);
  writeFileSync(notePath, note);
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", VALIDATE, notePath, "--template", tmplPath],
    { encoding: "utf8" },
  );
  assert.equal(
    result.status,
    0,
    `Expected PASS, got: ${result.stdout}\n${result.stderr}`,
  );
  assert.match(result.stdout, /PASS/);
}

async function testValidateFailsOnMissingSection() {
  const tmp = mkdtempSync(join(tmpdir(), "nd-test-"));
  const tmplPath = join(tmp, "template.md");
  const notePath = join(tmp, "note.md");

  const template = makeTemplate(
    { title: "{{title}}", tags: "[{{domain_tags}}]" },
    "# {{title}}\n\n## 场景\n\n{{scenario}}\n\n## 方案\n\n{{solution}}",
  );
  // Missing ## 方案
  const note = makeSimpleNote(
    { title: "测试", tags: "git" },
    "# 测试\n\n## 场景\n\n有场景但没方案",
  );

  writeFileSync(tmplPath, template);
  writeFileSync(notePath, note);
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", VALIDATE, notePath, "--template", tmplPath],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1, `Expected FAIL, got: ${result.stdout}`);
  assert.match(result.stdout, /FAIL/);
  assert.match(result.stdout, /缺少 section.*方案/);
}

async function testValidateOptionalSectionCanBeMissing() {
  const tmp = mkdtempSync(join(tmpdir(), "nd-test-"));
  const tmplPath = join(tmp, "template.md");
  const notePath = join(tmp, "note.md");

  const template = makeTemplate(
    { title: "{{title}}" },
    "# {{title}}\n\n## 场景\n\n{{scenario}}\n\n## 方案\n\n{{solution}}\n\n## 备注（可选）\n\n{{notes}}",
  );
  // Missing optional ## 备注
  const note = makeSimpleNote(
    { title: "测试" },
    "# 测试\n\n## 场景\n\nxxx\n\n## 方案\n\nyyy",
  );

  writeFileSync(tmplPath, template);
  writeFileSync(notePath, note);
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", VALIDATE, notePath, "--template", tmplPath],
    { encoding: "utf8" },
  );
  assert.equal(
    result.status,
    0,
    `Expected PASS for missing optional section, got: ${result.stdout}`,
  );
}

async function testValidateUnreplacedVariableInNote() {
  const tmp = mkdtempSync(join(tmpdir(), "nd-test-"));
  const tmplPath = join(tmp, "template.md");
  const notePath = join(tmp, "note.md");

  const template = makeTemplate(
    { title: "{{title}}" },
    "# {{title}}\n\n## 场景\n\n{{scenario}}",
  );
  const note = makeSimpleNote(
    { title: "{{title}}" },
    "# {{title}}\n\n## 场景\n\n场景内容",
  );

  writeFileSync(tmplPath, template);
  writeFileSync(notePath, note);
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", VALIDATE, notePath, "--template", tmplPath],
    { encoding: "utf8" },
  );
  assert.equal(
    result.status,
    1,
    `Expected FAIL for unreplaced variable, got: ${result.stdout}`,
  );
  assert.match(result.stdout, /未替换/);
}

async function testValidateTilTitlePrefix() {
  const tmp = mkdtempSync(join(tmpdir(), "nd-test-"));
  const tmplPath = join(tmp, "template.md");
  const notePath = join(tmp, "note.md");

  const template = makeTemplate(
    { title: "TIL: {{title}}", tags: "[til, {{domain_tags}}]", style: "til" },
    "# TIL: {{title}}\n\n## 场景\n\n{{scenario}}\n\n## 怎么做\n\n{{solution}}",
  );
  // Missing TIL: prefix
  const note = makeSimpleNote(
    { title: "git stash 保存部分文件", tags: "til, git", style: "til" },
    "# git stash 保存部分文件\n\n## 场景\n\n需要只暂存部分文件\n\n## 怎么做\n\ngit stash push -p",
  );

  writeFileSync(tmplPath, template);
  writeFileSync(notePath, note);
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", VALIDATE, notePath, "--template", tmplPath],
    { encoding: "utf8" },
  );
  assert.equal(
    result.status,
    1,
    `Expected FAIL for TIL without prefix, got: ${result.stdout}`,
  );
  assert.match(result.stdout, /TIL/);
}

async function testValidateNoteFileMissing() {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      VALIDATE,
      "/nonexistent/note.md",
      "--template",
      "/nonexistent/tmpl.md",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
}

async function testValidateTemplateFileMissing() {
  const tmp = mkdtempSync(join(tmpdir(), "nd-test-"));
  const notePath = join(tmp, "note.md");
  writeFileSync(notePath, "# test");

  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      VALIDATE,
      notePath,
      "--template",
      "/nonexistent/tmpl.md",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /模板文件不存在/);
}

async function testValidateCodeBlockWithoutLanguage() {
  const tmp = mkdtempSync(join(tmpdir(), "nd-test-"));
  const tmplPath = join(tmp, "template.md");
  const notePath = join(tmp, "note.md");

  const template = makeTemplate(
    { title: "{{title}}" },
    "# {{title}}\n\n## 场景\n\n{{scenario}}\n\n## 方案\n\n{{solution}}",
  );
  const note = makeSimpleNote(
    { title: "测试" },
    "# 测试\n\n## 场景\n\nxxx\n\n## 方案\n\n```\necho hello\n```",
  );

  writeFileSync(tmplPath, template);
  writeFileSync(notePath, note);
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", VALIDATE, notePath, "--template", tmplPath],
    { encoding: "utf8" },
  );
  assert.equal(
    result.status,
    0,
    "Code block without language is only a WARN, should pass",
  );
  assert.match(result.stdout, /WARN/);
  assert.match(result.stdout, /language/);
}

async function testValidateMissingFrontmatter() {
  const tmp = mkdtempSync(join(tmpdir(), "nd-test-"));
  const tmplPath = join(tmp, "template.md");
  const notePath = join(tmp, "note.md");

  const template = makeTemplate(
    { title: "{{title}}", created: "{{date}}" },
    "# {{title}}\n\n## 场景\n\n{{scenario}}",
  );
  const note = "# 测试\n\n## 场景\n\nxxx";

  writeFileSync(tmplPath, template);
  writeFileSync(notePath, note);
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", VALIDATE, notePath, "--template", tmplPath],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stdout, /缺少/);
}

const tests = [
  testCollectorRecordsAndRedacts,
  testCollectorFailOpenOnBadJson,
  testWrapperInvokesCollectorAndAnalyzer,
  testExtractNoteWindow,
  testAnalyzerAndCandidateExtraction,
  testContextReadsCandidateSourceRefs,
  testModelJsonParserFixture,
  testFakeAnalyzerProvider,
  testClaudeAnalyzerFallsBackToHeuristic,
  testClaudeAnalyzerFallbackNoneReturnsEmpty,
  testMultiStopPreservesConsumedStatus,
  testAnalyzePreservesPendingOnRerun,
  testProjectConfigOverridesGlobal,
  testProjectConfigDeepMergesNestedObjects,
  testAnalyzerLockSkipsWhenFreshLockExists,
  testAnalyzerBreaksStaleLockAndProceeds,
  testMergeConfigCommand,
  testCollectorRedactsSecretKey,
  testCandidateExtractionFiltersByTopic,
  testCandidateExtractionReportsTopicMiss,
  testCandidateExtractionFiltersToCurrentNoteWindow,
  testCandidateSelectionModes,
  testMarkCandidatesConsumed,
  testValidatePassesWithAllSections,
  testValidateFailsOnMissingSection,
  testValidateOptionalSectionCanBeMissing,
  testValidateUnreplacedVariableInNote,
  testValidateTilTitlePrefix,
  testValidateNoteFileMissing,
  testValidateTemplateFileMissing,
  testValidateCodeBlockWithoutLanguage,
  testValidateMissingFrontmatter,
];

for (const test of tests) {
  await test();
  console.log(`PASS ${test.name}`);
}
