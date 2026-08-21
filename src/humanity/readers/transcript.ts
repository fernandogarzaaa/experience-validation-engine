/**
 * Transcript reader — terminal sessions, CI logs, stack traces.
 *
 * The `CliAdapter` drives a live process; this reads the record one left
 * behind. That distinction matters more than it sounds: a transcript is the
 * artifact a person is handed when something has already gone wrong — pasted
 * into an issue, linked from a red build, scrolled through at 2am — and the
 * question is never "what can I click" but "what happened, and what am I
 * supposed to do now".
 *
 * So the structure this reader recovers is the one a reader actually looks
 * for: which commands were run, what each one printed, and where the errors
 * are. Each command opens a section, because that is the unit people scroll
 * between when they are hunting.
 */

import { stripAnsi } from "../../surface/affordances.js";
import type { Artifact, ReaderInput } from "../types.js";
import { ArtifactBuilder } from "./builder.js";

/** A shell prompt: `$ cmd`, `> cmd`, `user@host:~/dir$ cmd`, `PS C:\> cmd`. */
const PROMPT =
  /^(?:[\w.-]+@[\w.-]+[^$#>]*|PS [A-Za-z]:[^>]*|~[^$#>]*|\S*)?\s*(?:\$|#|>|❯|➜)\s+(\S.*)$/;
const ERROR_LINE =
  /\b(?:error|fatal|exception|traceback|panic|failed|failure|cannot|denied|refused|unable to|not found)\b/i;
const WARNING_LINE = /\b(?:warn|warning|deprecated)\b/i;
const STACK_FRAME = /^\s+(?:at\s|File\s"|\.\.\.)/;
const TIMESTAMP = /^\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/;
const LOG_LEVEL = /^\s*(?:\[)?(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)(?:\])?\b/;

export function detectTranscript(input: ReaderInput): number {
  if (input.extension === ".log") return 0.9;
  const lines = input.text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(0, 60);
  if (lines.length < 2) return 0;
  const prompts = lines.filter((l) => PROMPT.test(stripAnsi(l))).length;
  const logs = lines.filter(
    (l) => LOG_LEVEL.test(stripAnsi(l)) || TIMESTAMP.test(stripAnsi(l)),
  ).length;
  const traces = lines.filter((l) => STACK_FRAME.test(l)).length;
  const signal = (prompts * 2 + logs + traces) / lines.length;
  return signal >= 0.35 ? Math.min(0.85, 0.4 + signal) : 0;
}

export function readTranscript(input: ReaderInput): Artifact {
  const builder = new ArtifactBuilder(input.address, "transcript", input.genre ?? "transcript");
  const lines = input.text.split(/\r?\n/).map(stripAnsi);

  let output: string[] = [];
  let outputKind: "output" | "error" = "output";
  let sawCommand = false;

  const flush = (): void => {
    if (output.length === 0) return;
    const text = output
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    output = [];
    if (text) builder.add({ kind: outputKind, text });
    outputKind = "output";
  };

  for (const line of lines) {
    const command = PROMPT.exec(line);
    if (command) {
      flush();
      sawCommand = true;
      const text = (command[1] ?? "").trim();
      builder.startSection(text);
      builder.add({ kind: "command", text });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    // An error line pulls its whole surrounding block into the error kind:
    // a reader does not separate "the message" from "the lines around it".
    if (ERROR_LINE.test(line) && !WARNING_LINE.test(line)) outputKind = "error";
    output.push(line);
  }
  flush();

  if (!sawCommand) builder.setMeta("shape", "log");
  return builder.build();
}
