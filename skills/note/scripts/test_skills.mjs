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
// ROOT = skills/note/scripts/
const HOOK_CLI = join(ROOT, "..", "..", "..", "hooks", "note_distill_hook.ts");
const TOPIC_INFO = join(ROOT, "topic-info.ts");
const VALIDATE = join(ROOT, "validate-note.ts");

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

function hookCli(...args) {
  return [process.execPath, "--experimental-strip-types", HOOK_CLI, ...args];
}

function skillCli(script, ...args) {
  return [
    process.execPath,
    "--experimental-strip-types",
    join(ROOT, script),
    ...args,
  ];
}

function topicInfoCli(...args) {
  return [process.execPath, "--experimental-strip-types", TOPIC_INFO, ...args];
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
  const result = JSON.parse(run(skillCli("window.ts", eventsPath)).stdout);
  assert.equal(result.previous_note.prompt, "/note quick git squash");
  assert.equal(result.current_note.prompt, "/note deep note incremental scope");
  assert.deepEqual(
    result.events
      .filter((event) => event.event === "UserPromptSubmit")
      .map((event) => event.payload.prompt),
    ["新的技术讨论"]
  );
  // Window built on a log whose first user prompt is a normal discussion
  // (not /note) means the hook was online when the session began.
  assert.equal(result.coverage, "full");
}

function testWindowReportsPartialCoverageWhenHookJoinedMidSession() {
  // Scenario: user already had a long conversation BEFORE installing the
  // plugin (or before hooks were enabled). After enabling hooks, the very
  // first UserPromptSubmit recorded is the `/note` invocation itself. The
  // hook log is therefore an unreliable representation of session content
  // and the main agent must fall back to full history.
  const dir = tempDir();
  const eventsPath = join(dir, "events.jsonl");
  writeJsonl(eventsPath, [
    {
      event: "UserPromptSubmit",
      payload: { prompt: "/note 记录一下刚才聊的 NUMA 调度方案" },
    },
  ]);
  const result = JSON.parse(run(skillCli("window.ts", eventsPath)).stdout);
  assert.equal(result.coverage, "partial");
  // Current note is detected, no previous note.
  assert.equal(result.previous_note, null);
  assert.equal(
    result.current_note.prompt,
    "/note 记录一下刚才聊的 NUMA 调度方案"
  );
}

function testWindowReportsEmptyCoverageWhenNoEvents() {
  const dir = tempDir();
  const eventsPath = join(dir, "events.jsonl");
  writeFileSync(eventsPath, "", "utf8");
  const result = JSON.parse(run(skillCli("window.ts", eventsPath)).stdout);
  assert.equal(result.coverage, "empty");
  assert.deepEqual(result.events, []);
}

function testCandidatesCommandSurfacesCoverage() {
  // The candidates command should mirror the coverage field so the main
  // agent can branch on it without making a second `window` call.
  const dir = tempDir();
  const eventsPath = join(dir, "events.jsonl");
  const candidatesPath = join(dir, "note_candidates.jsonl");
  writeJsonl(eventsPath, [
    {
      event: "UserPromptSubmit",
      payload: { prompt: "/note 立刻就 /note 说明 hook 中途接入" },
    },
  ]);
  writeJsonl(candidatesPath, []);
  const result = JSON.parse(
    run(skillCli("candidates.ts", candidatesPath, "--events", eventsPath))
      .stdout
  );
  assert.equal(result.coverage, "partial");
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
  run(hookCli("analyze", eventsPath, "--output", candidatesPath), {
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
    run(skillCli("candidates.ts", candidatesPath)).stdout
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
    "utf8"
  );
  const context = JSON.parse(run(skillCli("context.ts", candidatePath)).stdout);
  assert.equal(context.contexts.length, 1);
  assert.deepEqual(
    context.contexts[0].events.map(
      (event) => event.payload.prompt || event.payload.last_assistant_message
    ),
    [
      "这个方案应该用 source_refs 补上下文",
      "方案：按 candidate source_refs 读取局部上下文。",
    ]
  );
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
    "utf8"
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
  run(hookCli("analyze", eventsPath, "--output", candidatesPath), {
    env: { NOTE_DISTILL_CONFIG: configPath },
  });
  const firstRun = readJsonl(candidatesPath);
  assert.equal(firstRun.length, 1);
  assert.equal(firstRun[0].status, "pending");
  const candId = firstRun[0].candidate_id;
  // Mark consumed
  run(
    skillCli(
      "mark-consumed.ts",
      candidatesPath,
      "--ids",
      candId,
      "--note-path",
      "/tmp/note.md"
    )
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
  run(hookCli("analyze", eventsPath, "--output", candidatesPath), {
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
    "utf8"
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
  run(hookCli("analyze", eventsPath, "--output", candidatesPath), {
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
  run(hookCli("analyze", eventsPath, "--output", candidatesPath), {
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
    "utf8"
  );
  writeFileSync(
    projectConfigPath,
    JSON.stringify({ candidate_analyzer: { provider: "fake", model: "fake" } }),
    "utf8"
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
  run(hookCli("analyze", eventsPath, "--output", candidatesPath), {
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
    "utf8"
  );
  writeFileSync(
    projectConfigPath,
    JSON.stringify({ candidate_analyzer: { provider: "fake" } }),
    "utf8"
  );
  const merged = JSON.parse(
    run(skillCli("merge-config.ts"), {
      env: { NOTE_DISTILL_CONFIG: globalConfigPath },
      cwd: dir,
    }).stdout
  );
  assert.equal(merged.candidate_analyzer.provider, "fake");
  assert.equal(merged.candidate_analyzer.model, "haiku");
  assert.equal(merged.candidate_analyzer.fallback, "heuristic");
}

function testMergeConfigCommand() {
  const dir = tempDir();
  const globalConfigPath = join(dir, "global-config.json");
  writeFileSync(
    globalConfigPath,
    JSON.stringify({
      adapter: "local-markdown",
      output_dir: "/tmp/global",
    }),
    "utf8"
  );
  const merged = JSON.parse(
    run(skillCli("merge-config.ts"), {
      env: { NOTE_DISTILL_CONFIG: globalConfigPath },
      cwd: dir,
    }).stdout
  );
  assert.equal(merged.adapter, "local-markdown");
  assert.equal(merged.output_dir, "/tmp/global");
}

function testMergeConfigIncludesEnabledField() {
  const dir = tempDir();
  const globalConfigPath = join(dir, "global-config.json");
  writeFileSync(
    globalConfigPath,
    JSON.stringify({
      adapter: "local-markdown",
      output_dir: dir,
      candidate_analyzer: {
        enabled: false,
        provider: "heuristic",
        model: "",
        fallback: "heuristic",
      },
    }),
    "utf8"
  );
  const merged = JSON.parse(
    run(skillCli("merge-config.ts"), {
      env: { NOTE_DISTILL_CONFIG: globalConfigPath },
    }).stdout
  );
  assert.equal(merged.candidate_analyzer.enabled, false);
}

function testMergeConfigResolvesSubagentModel() {
  const dir = tempDir();
  const globalConfigPath = join(dir, "global-config.json");
  writeFileSync(
    globalConfigPath,
    JSON.stringify({
      adapter: "local-markdown",
      output_dir: "/tmp",
      subagent: { model: "haiku" },
      model_map: {
        codebuddy: { haiku: "deepseek-v4-flash", sonnet: "deepseek-v4-pro" },
      },
    })
  );
  // claude-code — no mapping
  const claude = JSON.parse(
    run(skillCli("merge-config.ts", "--platform", "claude-code"), {
      env: { NOTE_DISTILL_CONFIG: globalConfigPath },
    }).stdout
  );
  assert.equal(claude.subagent_resolved_model, "haiku");
  // codebuddy — mapped
  const cb = JSON.parse(
    run(skillCli("merge-config.ts", "--platform", "codebuddy"), {
      env: { NOTE_DISTILL_CONFIG: globalConfigPath },
    }).stdout
  );
  assert.equal(cb.subagent_resolved_model, "deepseek-v4-flash");
  // no platform — no resolved field
  const noPlatform = JSON.parse(
    run(skillCli("merge-config.ts"), {
      env: { NOTE_DISTILL_CONFIG: globalConfigPath },
    }).stdout
  );
  assert.equal(noPlatform.subagent_resolved_model, undefined);
  // model not in map — passthrough (use "opus" to avoid deep-merge with example config)
  writeFileSync(
    globalConfigPath,
    JSON.stringify({
      adapter: "local-markdown",
      output_dir: "/tmp",
      subagent: { model: "opus" },
      model_map: { codebuddy: { haiku: "deepseek-v4-flash" } },
    })
  );
  const unmapped = JSON.parse(
    run(skillCli("merge-config.ts", "--platform", "codebuddy"), {
      env: { NOTE_DISTILL_CONFIG: globalConfigPath },
    }).stdout
  );
  assert.equal(unmapped.subagent_resolved_model, "opus");
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
    run(skillCli("candidates.ts", candidatesPath, "--topic", "JSONL 取舍"))
      .stdout
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
    run(skillCli("candidates.ts", candidatesPath, "--topic", "JSONL 取舍"))
      .stdout
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
    run(skillCli("candidates.ts", candidatesPath, "--events", eventsPath))
      .stdout
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
        skillCli(
          "candidates.ts",
          candidatesPath,
          "--selection",
          "auto",
          "--strategy",
          "oldest"
        )
      ).stdout
    ).selected_candidate_ids,
    ["first"]
  );
  assert.deepEqual(
    JSON.parse(
      run(
        skillCli(
          "candidates.ts",
          candidatesPath,
          "--selection",
          "auto",
          "--strategy",
          "newest"
        )
      ).stdout
    ).selected_candidate_ids,
    ["third"]
  );
  assert.deepEqual(
    JSON.parse(
      run(
        skillCli(
          "candidates.ts",
          candidatesPath,
          "--selection",
          "auto",
          "--strategy",
          "priority"
        )
      ).stdout
    ).selected_candidate_ids,
    ["second"]
  );
  const pick = JSON.parse(
    run(
      skillCli(
        "candidates.ts",
        candidatesPath,
        "--selection",
        "pick",
        "--max-options",
        "2"
      )
    ).stdout
  );
  assert.deepEqual(pick.candidates, []);
  assert.deepEqual(
    pick.pick_options.map((option) => option.candidate_id),
    ["first", "second"]
  );
  const all = JSON.parse(
    run(skillCli("candidates.ts", candidatesPath, "--selection", "all")).stdout
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
    skillCli(
      "mark-consumed.ts",
      candidatesPath,
      "--ids",
      "a",
      "--note-path",
      "/tmp/note.md"
    )
  );
  const records = readJsonl(candidatesPath);
  assert.equal(records[0].status, "consumed");
  assert.equal(records[0].note_path, "/tmp/note.md");
  assert.ok(records[0].consumed_at);
  assert.equal(records[1].status, "pending");
}

function testWindowWithSessionId() {
  const dir = tempDir();
  const sessionDir = join(dir, "sessions", "session-1");
  mkdirSync(sessionDir, { recursive: true });
  writeJsonl(join(sessionDir, "events.jsonl"), [
    {
      event: "UserPromptSubmit",
      payload: { prompt: "帮我写个 git stash 命令" },
    },
  ]);
  const result = JSON.parse(
    run(skillCli("window.ts", "--session-id", "session-1"), {
      env: { NOTE_DISTILL_DATA_DIR: dir },
    }).stdout
  );
  assert.equal(result.coverage, "full");
  assert.equal(result.events.length, 1);
}

function testCandidatesWithSessionId() {
  const dir = tempDir();
  const sessionDir = join(dir, "sessions", "session-2");
  mkdirSync(sessionDir, { recursive: true });
  writeJsonl(join(sessionDir, "events.jsonl"), [
    {
      event: "UserPromptSubmit",
      payload: { prompt: "怎么用 git rebase" },
    },
  ]);
  writeJsonl(join(sessionDir, "note_candidates.jsonl"), [
    {
      candidate_id: "c1",
      status: "pending",
      title: "git rebase",
      type: "command",
      range: { prompt_event_index: 0 },
    },
  ]);
  const result = JSON.parse(
    run(skillCli("candidates.ts", "--session-id", "session-2"), {
      env: { NOTE_DISTILL_DATA_DIR: dir },
    }).stdout
  );
  assert.equal(result.coverage, "full");
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].title, "git rebase");
}

function testMarkConsumedWithSessionId() {
  const dir = tempDir();
  const sessionDir = join(dir, "sessions", "session-3");
  mkdirSync(sessionDir, { recursive: true });
  const candidatesPath = join(sessionDir, "note_candidates.jsonl");
  writeJsonl(candidatesPath, [
    { candidate_id: "x", status: "pending", title: "X" },
  ]);
  run(
    skillCli(
      "mark-consumed.ts",
      "--session-id",
      "session-3",
      "--ids",
      "x",
      "--note-path",
      "/tmp/note.md"
    ),
    {
      env: { NOTE_DISTILL_DATA_DIR: dir },
    }
  );
  const records = readJsonl(candidatesPath);
  assert.equal(records[0].status, "consumed");
}

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
      created: "{{datetime}}",
    },
    "# {{title}}\n\n## 场景\n\n测试场景内容\n\n## 方案\n\n测试方案内容\n\n## 备注\n\n可选备注"
  );
  const note = makeSimpleNote(
    {
      title: "测试笔记",
      tags: "git, cli, ai-generated",
      created: "2026-05-19 14:30:00",
    },
    "# 测试笔记\n\n## 场景\n\n测试场景内容\n\n## 方案\n\n测试方案内容\n\n## 备注\n\n可选备注"
  );

  writeFileSync(tmplPath, template);
  writeFileSync(notePath, note);
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", VALIDATE, notePath, "--template", tmplPath],
    { encoding: "utf8" }
  );
  assert.equal(
    result.status,
    0,
    `Expected PASS, got: ${result.stdout}\n${result.stderr}`
  );
  assert.match(result.stdout, /PASS/);
}

async function testValidateFailsOnMissingSection() {
  const tmp = mkdtempSync(join(tmpdir(), "nd-test-"));
  const tmplPath = join(tmp, "template.md");
  const notePath = join(tmp, "note.md");

  const template = makeTemplate(
    { title: "{{title}}", tags: "[{{domain_tags}}]" },
    "# {{title}}\n\n## 场景\n\n{{scenario}}\n\n## 方案\n\n{{solution}}"
  );
  // Missing ## 方案
  const note = makeSimpleNote(
    { title: "测试", tags: "git" },
    "# 测试\n\n## 场景\n\n有场景但没方案"
  );

  writeFileSync(tmplPath, template);
  writeFileSync(notePath, note);
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", VALIDATE, notePath, "--template", tmplPath],
    { encoding: "utf8" }
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
    "# {{title}}\n\n## 场景\n\n{{scenario}}\n\n## 方案\n\n{{solution}}\n\n## 备注（可选）\n\n{{notes}}"
  );
  // Missing optional ## 备注
  const note = makeSimpleNote(
    { title: "测试" },
    "# 测试\n\n## 场景\n\nxxx\n\n## 方案\n\nyyy"
  );

  writeFileSync(tmplPath, template);
  writeFileSync(notePath, note);
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", VALIDATE, notePath, "--template", tmplPath],
    { encoding: "utf8" }
  );
  assert.equal(
    result.status,
    0,
    `Expected PASS for missing optional section, got: ${result.stdout}`
  );
}

async function testValidateUnreplacedVariableInNote() {
  const tmp = mkdtempSync(join(tmpdir(), "nd-test-"));
  const tmplPath = join(tmp, "template.md");
  const notePath = join(tmp, "note.md");

  const template = makeTemplate(
    { title: "{{title}}" },
    "# {{title}}\n\n## 场景\n\n{{scenario}}"
  );
  const note = makeSimpleNote(
    { title: "{{title}}" },
    "# {{title}}\n\n## 场景\n\n场景内容"
  );

  writeFileSync(tmplPath, template);
  writeFileSync(notePath, note);
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", VALIDATE, notePath, "--template", tmplPath],
    { encoding: "utf8" }
  );
  assert.equal(
    result.status,
    1,
    `Expected FAIL for unreplaced variable, got: ${result.stdout}`
  );
  assert.match(result.stdout, /未替换/);
}

// Style-specific constraints (TIL title prefix, char limit) have been removed
// from validate-note.ts — these are now enforced by the template itself.

async function testValidateTilTitlePrefixNoLongerEnforced() {
  const tmp = mkdtempSync(join(tmpdir(), "nd-test-"));
  const tmplPath = join(tmp, "template.md");
  const notePath = join(tmp, "note.md");

  const template = makeTemplate(
    { title: "TIL: {{title}}", tags: "[til, {{domain_tags}}]", style: "til" },
    "# TIL: {{title}}\n\n## 场景\n\n{{scenario}}\n\n## 怎么做\n\n{{solution}}"
  );
  // Title without TIL: prefix — validator no longer enforces this; template handles it
  const note = makeSimpleNote(
    { title: "git stash 保存部分文件", tags: "til, git", style: "til" },
    "# git stash 保存部分文件\n\n## 场景\n\n需要只暂存部分文件\n\n## 怎么做\n\ngit stash push -p"
  );

  writeFileSync(tmplPath, template);
  writeFileSync(notePath, note);
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", VALIDATE, notePath, "--template", tmplPath],
    { encoding: "utf8" }
  );
  // Should PASS — style-specific constraints have been removed from the validator
  assert.equal(
    result.status,
    0,
    `Expected PASS (style constraints removed), got: ${result.stdout}`
  );
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
    { encoding: "utf8" }
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
    { encoding: "utf8" }
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
    "# {{title}}\n\n## 场景\n\n{{scenario}}\n\n## 方案\n\n{{solution}}"
  );
  const note = makeSimpleNote(
    { title: "测试" },
    "# 测试\n\n## 场景\n\nxxx\n\n## 方案\n\n```\necho hello\n```"
  );

  writeFileSync(tmplPath, template);
  writeFileSync(notePath, note);
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", VALIDATE, notePath, "--template", tmplPath],
    { encoding: "utf8" }
  );
  assert.equal(
    result.status,
    0,
    "Code block without language is only a WARN, should pass"
  );
  assert.match(result.stdout, /WARN/);
  assert.match(result.stdout, /language/);
}

async function testValidateMissingFrontmatter() {
  const tmp = mkdtempSync(join(tmpdir(), "nd-test-"));
  const tmplPath = join(tmp, "template.md");
  const notePath = join(tmp, "note.md");

  const template = makeTemplate(
    { title: "{{title}}", created: "{{datetime}}" },
    "# {{title}}\n\n## 场景\n\n{{scenario}}"
  );
  const note = "# 测试\n\n## 场景\n\nxxx";

  writeFileSync(tmplPath, template);
  writeFileSync(notePath, note);
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", VALIDATE, notePath, "--template", tmplPath],
    { encoding: "utf8" }
  );
  assert.equal(result.status, 1);
  assert.match(result.stdout, /缺少/);
}

// ---- find-session tests ----

function testFindSessionReturnsMatchingSession() {
  const dir = tempDir();
  const sessionDir1 = join(dir, "sessions", "abc123def456");
  const sessionDir2 = join(dir, "sessions", "789ghi012");
  mkdirSync(sessionDir1, { recursive: true });
  mkdirSync(sessionDir2, { recursive: true });
  // Session 1: CodeBuddy, older
  writeJsonl(join(sessionDir1, "events.jsonl"), [
    {
      schema: 1,
      event: "UserPromptSubmit",
      session_id: "abc123def456",
      timestamp: "2026-06-01T10:00:00.000Z",
      cwd: "/Users/test/my-project",
      transcript_path:
        "/Users/test/Library/Application Support/CodeBuddyExtension/Data/x/CodeBuddyIDE/x/history/y/abc123def456/index.json",
      payload: { prompt: "hello" },
    },
  ]);
  // Session 2: Claude Code, newer, same cwd
  writeJsonl(join(sessionDir2, "events.jsonl"), [
    {
      schema: 1,
      event: "UserPromptSubmit",
      session_id: "789ghi012",
      timestamp: "2026-06-08T10:00:00.000Z",
      cwd: "/Users/test/my-project",
      transcript_path:
        "/Users/test/.claude/projects/-Users-test-my-project/789ghi012.jsonl",
      payload: { prompt: "hello" },
    },
  ]);
  const result = JSON.parse(
    run(skillCli("find-session.ts", "--cwd", "/Users/test/my-project"), {
      env: { NOTE_DISTILL_DATA_DIR: dir },
    }).stdout
  );
  assert.equal(result.session_id, "789ghi012");
  assert.equal(result.platform, "claude-code");
  assert.equal(result.cwd, "/Users/test/my-project");
}

function testFindSessionDetectsCodeBuddyPlatform() {
  const dir = tempDir();
  const sessionDir = join(dir, "sessions", "cb987654");
  mkdirSync(sessionDir, { recursive: true });
  writeJsonl(join(sessionDir, "events.jsonl"), [
    {
      schema: 1,
      event: "UserPromptSubmit",
      session_id: "cb987654",
      timestamp: "2026-06-08T10:00:00.000Z",
      cwd: "/Users/test/wiki",
      transcript_path:
        "/Users/test/Library/Application Support/CodeBuddyExtension/Data/x/CodeBuddyIDE/x/history/y/cb987654/index.json",
      payload: { prompt: "hello" },
    },
  ]);
  const result = JSON.parse(
    run(skillCli("find-session.ts", "--cwd", "/Users/test/wiki"), {
      env: { NOTE_DISTILL_DATA_DIR: dir },
    }).stdout
  );
  assert.equal(result.session_id, "cb987654");
  assert.equal(result.platform, "codebuddy");
}

function testFindSessionDetectsCodeBuddyOldFormat() {
  const dir = tempDir();
  const sessionDir = join(dir, "sessions", "old-cb-format");
  mkdirSync(sessionDir, { recursive: true });
  writeJsonl(join(sessionDir, "events.jsonl"), [
    {
      schema: 1,
      event: "UserPromptSubmit",
      session_id: "old-cb-format",
      timestamp: "2026-05-18T06:48:32.285Z",
      cwd: "/Users/test/photo-skills",
      transcript_path:
        "/Users/test/.codebuddy/projects/Users-test-photo-skills/old-cb-format.jsonl",
      payload: { prompt: "hello" },
    },
  ]);
  const result = JSON.parse(
    run(skillCli("find-session.ts", "--cwd", "/Users/test/photo-skills"), {
      env: { NOTE_DISTILL_DATA_DIR: dir },
    }).stdout
  );
  assert.equal(result.session_id, "old-cb-format");
  assert.equal(result.platform, "codebuddy");
}

function testFindSessionReturnsNullWhenNoMatch() {
  const dir = tempDir();
  const sessionDir = join(dir, "sessions", "nomatch");
  mkdirSync(sessionDir, { recursive: true });
  writeJsonl(join(sessionDir, "events.jsonl"), [
    {
      schema: 1,
      event: "UserPromptSubmit",
      session_id: "nomatch",
      timestamp: "2026-06-08T10:00:00.000Z",
      cwd: "/Users/test/other-project",
      transcript_path: "/tmp/transcript.jsonl",
      payload: { prompt: "hello" },
    },
  ]);
  const result = JSON.parse(
    run(skillCli("find-session.ts", "--cwd", "/Users/test/my-project"), {
      env: { NOTE_DISTILL_DATA_DIR: dir },
    }).stdout
  );
  assert.equal(result.session_id, "unknown");
  assert.equal(result.platform, "unknown");
}

function testFindSessionReturnsNewestMatch() {
  const dir = tempDir();
  const sessionDir1 = join(dir, "sessions", "older-session");
  const sessionDir2 = join(dir, "sessions", "newer-session");
  mkdirSync(sessionDir1, { recursive: true });
  mkdirSync(sessionDir2, { recursive: true });
  writeJsonl(join(sessionDir1, "events.jsonl"), [
    {
      schema: 1,
      event: "UserPromptSubmit",
      session_id: "older-session",
      timestamp: "2026-06-01T10:00:00.000Z",
      cwd: "/Users/test/my-project",
      transcript_path: "/tmp/transcript.jsonl",
      payload: { prompt: "old" },
    },
  ]);
  writeJsonl(join(sessionDir2, "events.jsonl"), [
    {
      schema: 1,
      event: "UserPromptSubmit",
      session_id: "newer-session",
      timestamp: "2026-06-08T10:00:00.000Z",
      cwd: "/Users/test/my-project",
      transcript_path: "/tmp/transcript.jsonl",
      payload: { prompt: "new" },
    },
  ]);
  const result = JSON.parse(
    run(skillCli("find-session.ts", "--cwd", "/Users/test/my-project"), {
      env: { NOTE_DISTILL_DATA_DIR: dir },
    }).stdout
  );
  assert.equal(result.session_id, "newer-session");
}

// ---- topic-info.ts tests ----

function makeTopicDir(dir, name, promptContent) {
  const topicDir = join(dir, name);
  mkdirSync(topicDir, { recursive: true });
  writeFileSync(join(topicDir, "prompt.md"), promptContent, "utf8");
  writeFileSync(join(topicDir, "template.md"), "# {{title}}", "utf8");
  return topicDir;
}

function testTopicInfoFrontmatterWithBothFields() {
  const dir = tempDir();
  makeTopicDir(
    dir,
    "test-topic",
    "---\naliases: [tt, test]\nscope: 测试 scope 描述\n---\n\n# Test Topic\n\n记录标准：测试内容。"
  );
  const result = JSON.parse(
    run(topicInfoCli("--name", "test-topic", "--topics-dir", dir)).stdout
  );
  assert.equal(result.found, true);
  assert.equal(result.canonical, "test-topic");
  assert.deepEqual(result.aliases, ["tt", "test"]);
  assert.equal(result.scope, "测试 scope 描述");
  assert.ok(result.prompt_path.includes("test-topic"));
  assert.ok(result.template_path.includes("test-topic"));
}

function testTopicInfoNoAliasesOnlyScope() {
  const dir = tempDir();
  makeTopicDir(
    dir,
    "scope-only",
    "---\nscope: 只有 scope 没有 aliases\n---\n\n# Scope Only\n\n记录标准：测试。"
  );
  const result = JSON.parse(
    run(topicInfoCli("--name", "scope-only", "--topics-dir", dir)).stdout
  );
  assert.equal(result.found, true);
  assert.deepEqual(result.aliases, []);
  assert.equal(result.scope, "只有 scope 没有 aliases");
}

function testTopicInfoNoScopeOnlyAliases() {
  const dir = tempDir();
  makeTopicDir(
    dir,
    "alias-only",
    "---\naliases: [ao]\n---\n\n# Alias Only\n\n记录标准：测试。"
  );
  const result = JSON.parse(
    run(topicInfoCli("--name", "alias-only", "--topics-dir", dir)).stdout
  );
  assert.equal(result.found, true);
  assert.deepEqual(result.aliases, ["ao"]);
  assert.equal(result.scope, "");
}

function testTopicInfoNoFrontmatter() {
  const dir = tempDir();
  makeTopicDir(dir, "no-fm", "# No Frontmatter\n\n记录标准：无 frontmatter。");
  const result = JSON.parse(
    run(topicInfoCli("--name", "no-fm", "--topics-dir", dir)).stdout
  );
  assert.equal(result.found, true);
  assert.equal(result.canonical, "no-fm");
  assert.deepEqual(result.aliases, []);
  assert.equal(result.scope, "");
}

function testTopicInfoEmptyFrontmatter() {
  const dir = tempDir();
  makeTopicDir(
    dir,
    "empty-fm",
    "---\n---\n\n# Empty Frontmatter\n\n记录标准：空 frontmatter。"
  );
  const result = JSON.parse(
    run(topicInfoCli("--name", "empty-fm", "--topics-dir", dir)).stdout
  );
  assert.equal(result.found, true);
  assert.deepEqual(result.aliases, []);
  assert.equal(result.scope, "");
}

function testTopicInfoAliasResolution() {
  const dir = tempDir();
  makeTopicDir(
    dir,
    "real-topic",
    "---\naliases: [rt, real]\nscope: Real topic scope\n---\n\n# Real Topic\n\n记录标准：测试。"
  );
  const result = JSON.parse(
    run(topicInfoCli("--name", "rt", "--topics-dir", dir)).stdout
  );
  assert.equal(result.found, true);
  assert.equal(result.canonical, "real-topic");
  assert.equal(result.query, "rt");
}

function testTopicInfoCanonicalNameMatch() {
  const dir = tempDir();
  makeTopicDir(
    dir,
    "canon",
    "---\naliases: [cn]\nscope: Canon test\n---\n\n# Canon\n\n记录标准：测试。"
  );
  const result = JSON.parse(
    run(topicInfoCli("--name", "canon", "--topics-dir", dir)).stdout
  );
  assert.equal(result.found, true);
  assert.equal(result.canonical, "canon");
}

function testTopicInfoNotFound() {
  const dir = tempDir();
  makeTopicDir(
    dir,
    "exists",
    "---\nscope: 存在的 topic\n---\n\n# Exists\n\n记录标准：测试。"
  );
  const result = JSON.parse(
    run(topicInfoCli("--name", "nonexistent", "--topics-dir", dir)).stdout
  );
  assert.equal(result.found, false);
  assert.equal(result.query, "nonexistent");
}

function testTopicInfoListAllSorted() {
  const dir = tempDir();
  makeTopicDir(dir, "b-topic", "---\nscope: B\n---\n\n# B");
  makeTopicDir(dir, "a-topic", "---\nscope: A\n---\n\n# A");
  makeTopicDir(dir, "c-topic", "---\nscope: C\n---\n\n# C");
  const result = JSON.parse(run(topicInfoCli("--topics-dir", dir)).stdout);
  // 3 user topics + built-in topics (scanned unconditionally)
  assert.ok(result.topics.length >= 3);
  // All topics sorted by canonical name
  const names = result.topics.map((t) => t.canonical);
  const sortedNames = [...names].sort();
  assert.deepEqual(
    names,
    sortedNames,
    "topics should be sorted by canonical name"
  );
  // Verify our 3 test topics exist
  assert.ok(names.includes("a-topic"));
  assert.ok(names.includes("b-topic"));
  assert.ok(names.includes("c-topic"));
  // Verify built-in topics are also scanned
  for (const name of ["adr", "arch", "investigation", "til"]) {
    assert.ok(
      names.includes(name),
      `built-in topic "${name}" should be in list`
    );
  }
}

function testTopicInfoTemplatePathNullWhenMissing() {
  const dir = tempDir();
  const topicDir = join(dir, "no-template");
  mkdirSync(topicDir, { recursive: true });
  writeFileSync(
    join(topicDir, "prompt.md"),
    "---\nscope: 没有 template.md\n---\n\n# No Template\n\n记录标准：测试。",
    "utf8"
  );
  // No template.md created
  const result = JSON.parse(
    run(topicInfoCli("--name", "no-template", "--topics-dir", dir)).stdout
  );
  assert.equal(result.found, true);
  assert.equal(result.template_path, null);
}

function testTopicInfoShadowing() {
  // --topics-dir topics shadow built-in topics of the same canonical name
  const userDir = tempDir();
  // Create user adr with aliases [design, override] — should shadow built-in arch's alias "design"
  // (design is used as shadow alias because arch is now a canonical name, not an alias)
  makeTopicDir(
    userDir,
    "adr",
    "---\naliases: [design, override]\nscope: User-defined scope\n---\n\n# User ADR\n\n记录标准：用户定义。"
  );
  const result = JSON.parse(
    run(topicInfoCli("--name", "design", "--topics-dir", userDir), {
      cwd: userDir,
    }).stdout
  );
  assert.equal(result.found, true);
  assert.equal(result.canonical, "adr");
  assert.deepEqual(result.aliases, ["design", "override"]);
  assert.equal(result.scope, "User-defined scope");
}

function testTopicInfoScopePreservesRoutingHints() {
  // scope retains →adr / →investigation routing hints as-is
  const dir = tempDir();
  makeTopicDir(
    dir,
    "arch",
    "---\naliases: [design]\nscope: 记录架构设计。不记录碎片知识点（→til）、问题排查（→investigation）。\n---\n\n# Arch\n\n边界与排他：\n- 不记录闲聊"
  );
  const result = JSON.parse(
    run(topicInfoCli("--name", "arch", "--topics-dir", dir)).stdout
  );
  assert.equal(result.found, true);
  assert.ok(result.scope.includes("→til"));
  assert.ok(result.scope.includes("→investigation"));
}

function testConfigExampleMatchesHookDefaults() {
  // Ensure config.example.json (human-readable, with _comment fields) stays in
  // sync with the defaults the hook actually uses at runtime.  The hook now
  // reads config.example.json as its default base, so merge-config with no
  // user config should produce the same structure (minus _comment fields).
  const examplePath = join(ROOT, "..", "config.example.json");
  const raw = JSON.parse(readFileSync(examplePath, "utf8"));
  // Strip _comment / _xxx annotation keys
  function stripComments(obj) {
    if (Array.isArray(obj)) return obj.map(stripComments);
    if (obj && typeof obj === "object") {
      const out = {};
      for (const [k, v] of Object.entries(obj)) {
        if (k.startsWith("_")) continue;
        out[k] = stripComments(v);
      }
      return out;
    }
    return obj;
  }
  const example = stripComments(raw);

  // Read hook defaults via merge-config with no user config (empty tmp dir)
  const dir = tempDir();
  const merged = JSON.parse(
    run(skillCli("merge-config.ts"), {
      env: { NOTE_DISTILL_CONFIG: join(dir, "nonexistent.json") },
      cwd: dir,
    }).stdout
  );

  // Compare only the keys that exist in config.example.json
  for (const key of Object.keys(example)) {
    if (key === "output_dir" || key === "obsidian_vault_path") continue; // path fields are user-specific
    assert.deepEqual(
      merged[key],
      example[key],
      `config.example.json "${key}" = ${JSON.stringify(
        example[key]
      )} but merge-config default = ${JSON.stringify(merged[key])}`
    );
  }
  // Also check that merge-config doesn't have config keys absent from example
  for (const key of Object.keys(merged)) {
    if (key === "output_dir" || key === "obsidian_vault_path") continue;
    assert.ok(
      key in example,
      `merge-config has "${key}" but config.example.json does not`
    );
  }
}

const tests = [
  testExtractNoteWindow,
  testWindowReportsPartialCoverageWhenHookJoinedMidSession,
  testWindowReportsEmptyCoverageWhenNoEvents,
  testCandidatesCommandSurfacesCoverage,
  testAnalyzerAndCandidateExtraction,
  testContextReadsCandidateSourceRefs,
  testMultiStopPreservesConsumedStatus,
  testAnalyzePreservesPendingOnRerun,
  testProjectConfigOverridesGlobal,
  testProjectConfigDeepMergesNestedObjects,
  testMergeConfigCommand,
  testMergeConfigIncludesEnabledField,
  testMergeConfigResolvesSubagentModel,
  testCandidateExtractionFiltersByTopic,
  testCandidateExtractionReportsTopicMiss,
  testCandidateExtractionFiltersToCurrentNoteWindow,
  testCandidateSelectionModes,
  testMarkCandidatesConsumed,
  testWindowWithSessionId,
  testCandidatesWithSessionId,
  testMarkConsumedWithSessionId,
  testValidatePassesWithAllSections,
  testValidateFailsOnMissingSection,
  testValidateOptionalSectionCanBeMissing,
  testValidateUnreplacedVariableInNote,
  testValidateTilTitlePrefixNoLongerEnforced,
  testValidateNoteFileMissing,
  testValidateTemplateFileMissing,
  testValidateCodeBlockWithoutLanguage,
  testValidateMissingFrontmatter,
  testFindSessionReturnsMatchingSession,
  testFindSessionDetectsCodeBuddyPlatform,
  testFindSessionDetectsCodeBuddyOldFormat,
  testFindSessionReturnsNullWhenNoMatch,
  testFindSessionReturnsNewestMatch,
  testTopicInfoFrontmatterWithBothFields,
  testTopicInfoNoAliasesOnlyScope,
  testTopicInfoNoScopeOnlyAliases,
  testTopicInfoNoFrontmatter,
  testTopicInfoEmptyFrontmatter,
  testTopicInfoAliasResolution,
  testTopicInfoCanonicalNameMatch,
  testTopicInfoNotFound,
  testTopicInfoListAllSorted,
  testTopicInfoTemplatePathNullWhenMissing,
  testTopicInfoShadowing,
  testTopicInfoScopePreservesRoutingHints,
  testConfigExampleMatchesHookDefaults,
];

for (const test of tests) {
  await test();
  console.log(`PASS ${test.name}`);
}
