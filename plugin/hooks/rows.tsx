/**
 * What a run did and does, as a transcript draws it: a member's record and
 * a meeting turn being spoken alike, a row for each thing it did.
 */
import type { Elements } from "claude-code";
import type { HuddleCall, HuddleEntry, HuddleLive } from "../types";
import { clip, oneLine } from "./text";

export type Ui = Pick<
  Elements["terminal"],
  "Box" | "Button" | "Input" | "Markdown" | "Select" | "Text"
>;

/** How many lines of a tool's output its row shows. */
const OUTPUT_LINES = 3;

/** A tool call's row: its name and main argument, then the first lines of what it gave. */
function toolRow(
  ui: Ui,
  key: string,
  call: HuddleCall & { state?: "done" | "error"; output?: string },
) {
  const { Box, Text } = ui;
  const { argument } = call;
  const lines = call.output?.trimEnd().split("\n") ?? [];
  const more = lines.length - OUTPUT_LINES;
  return (
    <Box key={key} flexDirection="column">
      <Text
        wrap="truncate-end"
        dimColor={!call.state}
        color={call.state === "error" ? "red" : undefined}
      >
        <Text bold>⏺ {call.name}</Text>
        {argument === undefined ? "" : `(${clip(argument)})`}
        {call.state ? "" : " …"}
      </Text>
      {lines.slice(0, OUTPUT_LINES).map((line, n) => (
        <Text key={`${key}-${n}`} dimColor wrap="truncate-end">
          {n === 0 ? "  ⎿  " : "     "}
          {line}
        </Text>
      ))}
      {more > 0 && (
        <Text key={`${key}-more`} dimColor>
          {"     "}… +{more} lines
        </Text>
      )}
    </Box>
  );
}

/** Words a member said: marked, drawn as Markdown. */
function saidRow(ui: Ui, key: string, text: string, dimColor = false) {
  const { Box, Markdown, Text } = ui;
  return (
    <Box key={key} flexDirection="row">
      <Text dimColor={dimColor}>⏺ </Text>
      <Box flexDirection="column" flexGrow={1}>
        <Markdown key={`${key}-md`} text={text} dimColor={dimColor} />
      </Box>
    </Box>
  );
}

function entryRow(ui: Ui, entry: HuddleEntry, key: string) {
  const { Text } = ui;
  switch (entry.kind) {
    case "run":
      return (
        <Text key={key} dimColor>
          ── {entry.text}
        </Text>
      );
    case "thinking":
      return (
        <Text key={key} dimColor italic wrap="truncate-end">
          ∴ {oneLine(entry.text)}
        </Text>
      );
    case "text":
      return saidRow(ui, key, entry.text);
    case "tool":
      return toolRow(ui, key, entry);
    case "steps":
      return (
        <Text key={key} dimColor>
          {entry.steps
            .map(
              (s) =>
                `${s.status === "completed" ? "☒" : s.status === "in_progress" ? "▸" : "☐"} ${s.content}`,
            )
            .join("\n")}
        </Text>
      );
    case "notice":
      return (
        <Text key={key} dimColor>
          · {entry.text}
        </Text>
      );
  }
}

/** A run's rows: what it did (`entries`), then what it does now; `key` keeps one's rows apart from another's. */
export function runRows(ui: Ui, key: string, entries: HuddleEntry[], live: HuddleLive | undefined) {
  const { Box, Text } = ui;
  const quiet = !entries.length && !live?.streaming && !live?.starting && !live?.running.length;
  return (
    <Box key={key} flexDirection="column">
      {quiet && <Text dimColor>…</Text>}
      {entries.map((entry, i) => entryRow(ui, entry, `${key}-e${i}`))}
      {live?.running.map((call, i) => toolRow(ui, `${key}-run${i}`, call))}
      {live?.starting && (
        <Text dimColor>
          <Text bold>⏺ {live.starting}</Text> …
        </Text>
      )}
      {live?.streaming?.kind === "text" &&
        saidRow(ui, `${key}-streaming`, live.streaming.text, true)}
      {live?.streaming?.kind === "thinking" && (
        <Box flexDirection="row">
          <Text dimColor italic>
            ∴{" "}
          </Text>
          <Text dimColor italic wrap="truncate-start">
            {oneLine(live.streaming.text)}
          </Text>
        </Box>
      )}
    </Box>
  );
}
