/**
 * openplan's mod (docs/design.md §7.2): the pane, the band above the prompt,
 * toasts for what needs you, transcript rows for milestones, and the
 * `/openplan` command. It draws what the MCP server's `view` tool gives and
 * answers through its `answer` tool, with no model in between; the model is
 * kept from both.
 */
import { atom, read, update } from "claude-code";
import type { Elements, EngineInterface, Register } from "claude-code";

import type {
  OpenplanEntry,
  OpenplanMeeting,
  OpenplanNeed,
  OpenplanRecord,
  OpenplanTab,
  OpenplanTeam,
  OpenplanView,
} from "../types";

type $ = EngineInterface;
type Ui = Pick<Elements["terminal"], "Box" | "Button" | "Input" | "Markdown" | "Select" | "Text">;

const PANE = "openplan";
/** The tools only the pane calls, as the model would name them. */
const PANE_ONLY = /^mcp__plugin_openplan_openplan__(view|answer)$/;
const PANE_ONLY_REASON = "This tool is openplan's pane's: the user answers there, in /openplan.";
/** How often the pane asks the team how it stands. */
const POLL_MS = 500;
/** How many of a followed record's entries the pane keeps. */
const RECORD_KEEP = 200;
/** How much of a member's thinking, or of a tool's argument, a row shows. */
const ROW_TEXT = 300;

const team = atom({ plugin: "openplan", key: "team" } as const, null, { shape: "team-1" });
const speaking = atom({ plugin: "openplan", key: "speaking" } as const, null);
const record = atom({ plugin: "openplan", key: "record" } as const, null, { shape: "record-1" });
const problem = atom({ plugin: "openplan", key: "problem" } as const, null);
const tab = atom({ plugin: "openplan", key: "tab" } as const, "team");
const picks = atom({ plugin: "openplan", key: "picks" } as const, {});

const TABS: { tab: OpenplanTab; label: string }[] = [
  { tab: "meeting", label: "Meeting" },
  { tab: "team", label: "Team" },
  { tab: "needs", label: "Needs you" },
];

const DECISIONS: Record<string, string> = {
  accept: "Accept",
  rereview: "Review again",
  skip: "Skip the review",
  sendBack: "Send back",
  ours: "Keep ours",
  theirs: "Take theirs",
  retry: "Retry",
};

const PERMISSIONS = { once: "Allow once", always: "Always allow", deny: "Deny" } as const;

/** The name `$.mcp.call` takes for openplan's server, once connected. */
let server: string | undefined;
/** The revision of the team the pane has. */
let revision: number | undefined;
/** Needs and milestones told already; those there at the first look are not news. */
let told: Set<string> | undefined;
let polling = false;

const clip = (text: string) => (text.length > ROW_TEXT ? `${text.slice(0, ROW_TEXT)}…` : text);

const words = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A tool call in a line: its name and its main argument. */
function callLine(name: string, input: unknown): string {
  const fields = (input ?? {}) as Record<string, unknown>;
  const main = ["command", "file_path", "path", "pattern", "url", "description"]
    .map((key) => fields[key])
    .find((value) => typeof value === "string");
  return main ? `${name} ${clip(String(main))}` : name;
}

/** What a need asks, in a line, for a toast. */
function needLine(need: OpenplanNeed): string {
  switch (need.kind) {
    case "permission":
      return `${need.from} asks to use ${need.call}`;
    case "choices":
      return `${need.from} asks: ${need.choices.map((c) => c.question).join(" ")}`;
    case "decision":
      return need.text ? `${need.from}: ${need.text}` : `${need.about} waits on you`;
  }
}

/** Calls one of openplan's server's tools: its text, or its error thrown. */
async function call($: $, tool: string, args: Record<string, unknown> = {}): Promise<string> {
  if (!server) {
    const connected = await $.mcp.connect("openplan");
    if (!connected.isConnected) throw new Error(connected.message);
    server = connected.server;
  }
  const result = await $.mcp.call(server, tool, args);
  const text = result.content.find((block) => block.type === "text")?.text ?? "";
  if (result.isError) throw new Error(text);
  return text;
}

function openPane($: $) {
  return $.ui.open({ id: PANE, title: "openplan" });
}

/** Answers a need as it was pressed; what the team refuses is shown. */
async function answer($: $, need: OpenplanNeed, args: Record<string, unknown>) {
  try {
    await call($, "answer", { question: need.id, ...args });
  } catch (error) {
    $.ui.toast(`openplan: ${words(error)}`);
  }
}

/** Tells what is new since the last look: a toast for what needs you, a row for a milestone. */
function tell($: $, now: OpenplanTeam) {
  const keys = [...now.needs.map((n) => `need:${n.id}`), ...now.milestones.map((m) => m.key)];
  if (told) {
    for (const need of now.needs)
      if (!told.has(`need:${need.id}`)) {
        $.ui.toast(`openplan: ${needLine(need)}. Answer it in /openplan.`);
        void openPane($);
      }
    for (const milestone of now.milestones)
      if (!told.has(milestone.key)) $.ui.log(`openplan: ${milestone.text}`);
  }
  told = new Set(keys);
}

/** The followed record with what came since, following its member onto new work. */
function followed(was: OpenplanRecord | null, view: OpenplanView): OpenplanRecord | null {
  if (!was) return was;
  const member = view.team?.members.find((m) => m.name === was.member);
  if (member?.subtask && member.subtask !== was.subtask)
    return { member: was.member, subtask: member.subtask, entries: [], next: 0 };
  const got = view.record;
  if (!got || got.subtask !== was.subtask) return was;
  if (!got.entries.length && JSON.stringify(got.live) === JSON.stringify(was.live)) return was;
  return {
    member: was.member,
    subtask: was.subtask,
    entries: [...was.entries, ...got.entries].slice(-RECORD_KEEP),
    next: got.next,
    ...(got.live && { live: got.live }),
  };
}

/** Asks the team how it stands, and keeps what changed for the drawings. */
async function poll($: $) {
  if (polling) return;
  polling = true;
  try {
    const following = await read($, record);
    const view = JSON.parse(
      await call($, "view", {
        ...(revision !== undefined && { revision }),
        ...(following && { record: { subtask: following.subtask, from: following.next } }),
      }),
    ) as OpenplanView;
    revision = view.revision;
    await update($, problem, () => null);
    if (view.team) {
      tell($, view.team);
      await update($, team, () => view.team ?? null);
    }
    const said = view.speaking ?? null;
    await update($, speaking, (was) => (JSON.stringify(was) === JSON.stringify(said) ? was : said));
    await update($, record, (was) => followed(was, view));
  } catch (error) {
    const why = words(error);
    revision = undefined;
    await update($, problem, (was) => (was === why ? was : why));
  } finally {
    polling = false;
  }
}

async function meetingTab($: $, ui: Ui, meeting: OpenplanMeeting | undefined) {
  const { Box, Markdown, Text } = ui;
  if (!meeting) return <Text dimColor>No meeting yet: ask your session to hold one.</Text>;
  const live = await read($, speaking);
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>
          {meeting.agenda} · {meeting.status}
        </Text>
        <Text dimColor>
          {meeting.participants.join(", ")}, hosted by {meeting.participants[0]}
        </Text>
      </Box>
      {meeting.turns.map((turn, i) => (
        <Box key={`turn-${i}`} flexDirection="column">
          <Text bold>
            {turn.speaker}
            {turn.to ? ` → ${turn.to}` : ""}
          </Text>
          <Markdown key={`said-${i}`} text={turn.text} />
        </Box>
      ))}
      {live && (
        <Box flexDirection="column">
          <Text bold>{live.speaker}</Text>
          <Markdown key="speaking" text={live.text || "…"} dimColor />
        </Box>
      )}
      {meeting.hands.length > 0 && (
        <Text dimColor>
          Hands up: {meeting.hands.map((h) => `${h.member} (${h.point})`).join(", ")}
        </Text>
      )}
      {meeting.plan && <Text>Plan: {meeting.plan}</Text>}
    </Box>
  );
}

function entryRow(ui: Ui, entry: OpenplanEntry, i: number) {
  const { Markdown, Text } = ui;
  switch (entry.kind) {
    case "run":
      return (
        <Text key={`e-${i}`} dimColor>
          ── a run on {entry.model}
        </Text>
      );
    case "thinking":
      return (
        <Text key={`e-${i}`} dimColor italic>
          {clip(entry.text)}
        </Text>
      );
    case "text":
      return <Markdown key={`e-${i}`} text={entry.text} />;
    case "tool":
      return (
        <Text key={`e-${i}`} color={entry.state === "error" ? "red" : undefined}>
          {entry.state === "error" ? "✗" : "✓"} {callLine(entry.name, entry.input)}
        </Text>
      );
    case "steps":
      return (
        <Text key={`e-${i}`} dimColor>
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
        <Text key={`e-${i}`} dimColor>
          · {entry.notice.kind}
        </Text>
      );
  }
}

function recordView($: $, ui: Ui, shown: OpenplanRecord) {
  const { Box, Button, Text } = ui;
  const { live } = shown;
  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text bold>{shown.member}'s record</Text>
        <Button key="unfollow" label="Close" onPress={() => update($, record, () => null)} />
      </Box>
      {shown.entries.map((entry, i) => entryRow(ui, entry, i))}
      {live?.running.map((run, i) => (
        <Text key={`run-${i}`} dimColor>
          … {callLine(run.name, run.input)}
        </Text>
      ))}
      {live?.starting && <Text dimColor>… {live.starting}</Text>}
      {live?.streaming && (
        <Text dimColor italic={live.streaming.kind === "thinking"}>
          {clip(live.streaming.text)}
        </Text>
      )}
    </Box>
  );
}

async function teamTab($: $, ui: Ui, now: OpenplanTeam) {
  const { Box, Button, Text } = ui;
  const shown = await read($, record);
  return (
    <Box flexDirection="column" gap={1}>
      {now.members.map((member) => (
        <Box key={`m-${member.name}`} flexDirection="column">
          <Button
            key={`follow-${member.name}`}
            plain
            onPress={() => {
              const { subtask } = member;
              if (subtask)
                void update($, record, () => ({
                  member: member.name,
                  subtask,
                  entries: [],
                  next: 0,
                }));
            }}
          >
            <Text bold>{member.name}</Text>
            <Text dimColor>
              {" "}
              {member.role}
              {member.model ? ` · ${member.model}` : ""} · {member.tokens.toLocaleString()} tokens
            </Text>
          </Button>
          <Text>{member.doing}</Text>
        </Box>
      ))}
      {shown ? (
        recordView($, ui, shown)
      ) : (
        <Text dimColor>Select a member to follow their record.</Text>
      )}
    </Box>
  );
}

async function needView($: $, ui: Ui, need: OpenplanNeed) {
  const { Box, Button, Input, Markdown, Select, Text } = ui;
  const head = (
    <Box flexDirection="column">
      <Text bold>
        {need.from}
        {need.about && <Text dimColor> · {need.about}</Text>}
      </Text>
      {need.kind !== "choices" && need.text && <Markdown key={`t-${need.id}`} text={need.text} />}
    </Box>
  );
  const mine = await read($, picks);
  switch (need.kind) {
    case "permission":
      return (
        <Box key={`n-${need.id}`} flexDirection="column">
          {head}
          <Text>{need.call}</Text>
          <Box gap={1}>
            {need.options.map((option) => (
              <Button
                key={`${need.id}-${option}`}
                label={PERMISSIONS[option]}
                variant={option === "once" ? "primary" : "secondary"}
                onPress={() => answer($, need, { option })}
              />
            ))}
          </Box>
          <Input
            key={`${need.id}-note`}
            placeholder="Or deny it with a note"
            submitLabel="Deny"
            onSubmit={(note) => answer($, need, { option: "deny", note })}
          />
        </Box>
      );
    case "choices": {
      const chosen = mine[need.id] ?? [];
      // Answered once every question has its pick.
      const pick = (index: number, value: string) =>
        update($, picks, (all) => {
          const now = [...(all[need.id] ?? [])];
          now[index] = value;
          if (need.choices.some((_, i) => now[i] === undefined)) return { ...all, [need.id]: now };
          void answer($, need, { picks: now });
          return Object.fromEntries(Object.entries(all).filter(([id]) => id !== need.id));
        });
      return (
        <Box key={`n-${need.id}`} flexDirection="column">
          {head}
          {need.choices.map((choice, i) => (
            <Box key={`${need.id}-${i}`} flexDirection="column">
              <Text>{choice.question}</Text>
              {choice.multiSelect ? (
                <Input
                  key={`${need.id}-${i}-many`}
                  label={choice.header}
                  placeholder={`Any of: ${choice.options.join(", ")}`}
                  onSubmit={(value) => pick(i, value)}
                />
              ) : (
                <Select
                  key={`${need.id}-${i}-one`}
                  label={choice.header}
                  options={choice.options.map((label) => ({ value: label, label }))}
                  value={chosen[i]}
                  onSelect={(value) => pick(i, value)}
                />
              )}
            </Box>
          ))}
        </Box>
      );
    }
    case "decision": {
      // A revised task goes back to the subtask that asked, unless you pick another.
      const [back] = mine[`${need.id}:back`] ?? [];
      return (
        <Box key={`n-${need.id}`} flexDirection="column">
          {head}
          <Box gap={1}>
            {need.options
              .filter((option) => option !== "revise")
              .map((option) => (
                <Button
                  key={`${need.id}-${option}`}
                  label={DECISIONS[option] ?? option}
                  onPress={() => answer($, need, { decision: option })}
                />
              ))}
          </Box>
          {need.options.includes("revise") && need.sendBack && need.sendBack.length > 1 && (
            <Select
              key={`${need.id}-back`}
              label="Send back"
              options={need.sendBack.map((s) => ({ value: s.id, label: s.title }))}
              value={back}
              onSelect={(value) =>
                update($, picks, (all) => ({ ...all, [`${need.id}:back`]: [value] }))
              }
            />
          )}
          {need.options.includes("revise") && (
            <Input
              key={`${need.id}-revise`}
              placeholder="What to change"
              submitLabel="Send back"
              onSubmit={(note) =>
                answer($, need, { decision: "revise", note, ...(back && { sent_back: back }) })
              }
            />
          )}
        </Box>
      );
    }
  }
}

async function needsTab($: $, ui: Ui, needs: OpenplanNeed[]) {
  const { Box, Text } = ui;
  if (!needs.length) return <Text dimColor>Nothing waits on you.</Text>;
  const views = [];
  for (const need of needs) views.push(await needView($, ui, need));
  return (
    <Box flexDirection="column" gap={1}>
      {views}
    </Box>
  );
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "openplan",
      description: "Show openplan's team in a pane; `/openplan status` prints where it stands",
      argumentHint: "[status]",
    });
    $.clock.every(POLL_MS, () => void poll($));
    return next(e);
  });

  on("command.run", { command: "openplan" }, async ($, e) => {
    if (e.args.trim() !== "status") {
      await openPane($);
      return {};
    }
    try {
      return { text: await call($, "status") };
    } catch (error) {
      return { text: `openplan: ${words(error)}` };
    }
  });

  // The pane's tools are the person's: the model never answers a permission for them.
  on("tool.check", { tool: PANE_ONLY }, () => ({
    decision: "deny",
    reason: PANE_ONLY_REASON,
  })).catch(() => ({ decision: "deny", reason: PANE_ONLY_REASON }));
  on("tool.describe", { tool: PANE_ONLY }, async ($, e, next) => ({
    ...(await next(e)),
    isDeferred: true,
  }));

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const now = await read($, team);
    if (!now?.band || e.props.hasSurvey) return next(e);
    const { Box, Button, Text } = $.ui.resolve(e);
    return (
      <Box>
        <Button key="openplan" plain onPress={() => void openPane($)}>
          <Text dimColor>openplan · {now.band}</Text>
        </Button>
      </Box>
    );
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const ui: Ui = $.ui.resolve(e);
    const { Box, Button, Text } = ui;
    const now = await read($, team);
    const why = await read($, problem);
    if (!now) return <Text dimColor>{why ?? "Looking for the repository's team…"}</Text>;
    const shown = await read($, tab);
    return (
      <Box flexDirection="column" gap={1}>
        <Box gap={1}>
          {TABS.map((t) => (
            <Button
              key={`tab-${t.tab}`}
              label={
                t.tab === "needs" && now.needs.length ? `${t.label} (${now.needs.length})` : t.label
              }
              variant={t.tab === shown ? "primary" : "secondary"}
              onPress={() => update($, tab, () => t.tab)}
            />
          ))}
        </Box>
        {why && <Text color="red">{why}</Text>}
        {shown === "meeting"
          ? await meetingTab($, ui, now.meeting)
          : shown === "team"
            ? await teamTab($, ui, now)
            : await needsTab($, ui, now.needs)}
      </Box>
    );
  });
};
