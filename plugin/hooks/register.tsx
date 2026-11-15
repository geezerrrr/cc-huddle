/**
 * openplan's mod (docs/design.md §7.2): the pane, the band above the prompt,
 * asks for what needs you, transcript rows for milestones, prompts to your
 * session for what needs a conversation, and the `/openplan` command, which
 * hands the team a task. It draws what the MCP server serves on the pane's
 * socket, which the `pane` tool names, and answers through the `answer`
 * tool, with no model in between; the model is kept from both tools.
 */
import { atom, read, update } from "claude-code";
import type { Elements, EngineInterface, Register, Timer } from "claude-code";

import type {
  OpenplanCall,
  OpenplanEntry,
  OpenplanLive,
  OpenplanMeeting,
  OpenplanNeed,
  OpenplanRecord,
  OpenplanTab,
  OpenplanTeam,
  OpenplanView,
} from "../types";

type $ = EngineInterface;
type Ui = Pick<Elements["terminal"], "Box" | "Button" | "Input" | "Markdown" | "Select" | "Text">;

/** This plugin: as `next.origin` names the caller of a `$` call, and its server (its atoms spell it out: the state scan reads literals). */
const PLUGIN = "openplan";
/** The pane, which has the plugin's name. */
const PANE = PLUGIN;
/** The server's tools, as the model names them. */
const TOOLS = /^mcp__plugin_openplan_openplan__/;
/** The tools only the mod calls, as the model would name them. */
const PANE_ONLY = /^mcp__plugin_openplan_openplan__(pane|answer|hand_off|resume_goal)$/;
const PANE_ONLY_REASON = "This tool is the user's, in /openplan.";
/** How often the pane asks the team how it stands. */
const POLL_MS = 500;
/** How many of a followed record's entries the pane keeps. */
const RECORD_KEEP = 200;
/** How much of a tool's argument, or of what is stuck, a row shows. */
const ROW_TEXT = 300;
/** How many lines of a tool's output its row shows. */
const OUTPUT_LINES = 3;
/** The keys that work in the pane, its last line. */
const KEYS =
  "1 meeting · 2 team · 3 needs you · tab or ↑/↓ to select · enter to press · esc to the prompt";

const team = atom({ plugin: "openplan", key: "team" } as const, null, { shape: "team-3" });
const speaking = atom({ plugin: "openplan", key: "speaking" } as const, null, {
  shape: "speaking-2",
});
const record = atom({ plugin: "openplan", key: "record" } as const, null, { shape: "record-2" });
const problem = atom({ plugin: "openplan", key: "problem" } as const, null);
const tab = atom({ plugin: "openplan", key: "tab" } as const, "team");
const picks = atom({ plugin: "openplan", key: "picks" } as const, {});

const TABS: { tab: OpenplanTab; label: string; hotkey: string }[] = [
  { tab: "meeting", label: "Meeting", hotkey: "1" },
  { tab: "team", label: "Team", hotkey: "2" },
  { tab: "needs", label: "Needs you", hotkey: "3" },
];

/** The name `$.mcp.call` takes for openplan's server, once connected. */
let server: string | undefined;
/** The socket the server serves the pane's view on, once the `pane` tool named it. */
let socket: string | undefined;
/** The revision of the team the pane has. */
let revision: number | undefined;
/** Milestones and prompts told already; those there at the first look are not news. */
let told: Set<string> | undefined;
/**
 * The goal you took up here (`/openplan resume`), until the view has it:
 * what waits in it for a conversation is put to your session at once, and
 * its milestones so far are not news.
 */
let takenUp: string | undefined;
let polling = false;
/** Needs put to you in a question dialog already; one dismissed waits in the pane. */
const asked = new Set<string>();
/** The asks, one after another in the order the needs came. */
let asking = Promise.resolve();
/**
 * The poll, while it runs. It stops when the server can't read the goals (the
 * session isn't in a repository), and starts again when you or your session
 * turn to openplan.
 */
let ticking: Timer | undefined;

/** What the server answered with an error: the goals can't be read, or it refused what was asked. */
class Refused extends Error {}

const clip = (text: string) => (text.length > ROW_TEXT ? `${text.slice(0, ROW_TEXT)}…` : text);

const words = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Text in one line, its runs of space and line breaks one space each. */
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** A question dialog's chip holds this many characters. */
const ASK_HEADER = 12;

/** The options a need's buttons and dialog offer: all but one that is no answer without a note. */
const pickable = (need: Extract<OpenplanNeed, { kind: "options" }>) =>
  need.options.filter((o) => !(need.note?.needed && o.value === need.note.option));

/**
 * Puts a need to you in Claude Code's question dialog, and gives what the
 * `answer` tool takes for what you said; undefined when what you typed
 * answers nothing. Rejects when you dismiss it.
 */
async function askedAnswer($: $, need: OpenplanNeed): Promise<Record<string, unknown> | undefined> {
  if (need.kind === "choices") {
    const chosen: string[] = [];
    for (const choice of need.choices)
      chosen.push(
        await $.ui.ask(`${need.headline} ${choice.question}`, {
          options: choice.options,
          header: (choice.header || need.from).slice(0, ASK_HEADER),
          ...(choice.multiSelect && { multiSelect: true as const }),
        }),
      );
    return { picks: chosen };
  }
  const said = await $.ui.ask(
    need.detail ? `${need.headline}\n${clip(need.detail)}` : need.headline,
    { options: pickable(need).map((o) => o.label), header: need.from.slice(0, ASK_HEADER) },
  );
  const option = need.options.find((o) => o.label === said);
  if (option) return { option: option.value };
  // What you type instead goes with the option a note goes with, where there is one.
  return need.note ? { option: need.note.option, note: said } : undefined;
}

/** Asks a need that is still open, and answers it as you said; dismissed, it waits in the pane. */
async function askNeed($: $, need: OpenplanNeed) {
  // Answered meanwhile, in the pane: nothing left to ask.
  if (!(await read($, team))?.needs.some((n) => n.id === need.id)) return;
  let args;
  try {
    args = await askedAnswer($, need);
  } catch {
    // Dismissed: it waits in "Needs you".
    return;
  }
  if (args) await answer($, need, args);
}

/** Calls one of openplan's server's tools: its text, or its error thrown. */
async function call($: $, tool: string, args: Record<string, unknown> = {}): Promise<string> {
  if (!server) {
    const connected = await $.mcp.connect(PLUGIN);
    if (!connected.isConnected) throw new Error(connected.message);
    server = connected.server;
  }
  const result = await $.mcp.call(server, tool, args);
  const text = result.content.find((block) => block.type === "text")?.text ?? "";
  if (result.isError) throw new Refused(text);
  return text;
}

/**
 * The team as the server has it, through the pane's socket: not a tool call,
 * so your tool hooks don't run twice a second. A server started again has a
 * new socket, asked for after the old one fails.
 */
async function view($: $, args: Record<string, unknown>): Promise<OpenplanView> {
  socket ??= await call($, "pane");
  let response;
  try {
    response = await $.http.fetch("http://openplan/view", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
      socketPath: socket,
    });
  } catch (error) {
    socket = undefined;
    throw error;
  }
  if (!response.ok) throw new Refused(response.text);
  return JSON.parse(response.text) as OpenplanView;
}

/** Polls the team, unless it does already. */
function watch($: $) {
  ticking ??= $.clock.every(POLL_MS, () => void poll($));
}

/** Claude Code's question dialog offers at most this many options. */
const ASK_OPTIONS = 4;

/**
 * Resumes your session's goal or takes up another (§7.3): the only one; with
 * several, the one you pick in the question dialog, or the one numbered
 * `number` when there are more than it holds, as listed. While your
 * session's goal is active, it says to pause it first.
 */
async function resumeGoal($: $, number?: number): Promise<string> {
  const now = (await view($, {})).team;
  if (now?.resumeRefused) return now.resumeRefused;
  const listed = (now?.resumable ?? []).map((goal, i) => ({
    slug: goal.slug,
    name: goal.label,
    label: `${String(i + 1)}. ${goal.label}`,
  }));
  if (!listed.length) return "No goal to resume.";
  if (number === undefined && listed.length > ASK_OPTIONS)
    return [
      "Goals; resume one with /openplan resume <number>:",
      ...listed.map((g) => g.label),
    ].join("\n");
  const goal =
    number !== undefined
      ? listed[number - 1]
      : listed.length === 1
        ? listed[0]
        : await picked($, listed);
  if (!goal)
    return number === undefined ? "Nothing resumed." : `No goal is numbered ${String(number)}.`;
  const said = await call($, "resume_goal", { goal: goal.slug });
  takenUp = goal.slug;
  return said;
}

/** The goal you pick in the question dialog; none when you dismiss it or type something else. */
async function picked<T extends { label: string }>($: $, listed: T[]): Promise<T | undefined> {
  try {
    const said = await $.ui.ask("Which goal should go on?", {
      options: listed.map((g) => g.label),
      header: "Resume",
    });
    return listed.find((g) => g.label === said);
  } catch {
    return undefined;
  }
}

/** Opens the pane with the keyboard: only ever on the person's command or press. */
async function openPane($: $) {
  const shown = await read($, record);
  await $.ui.open({ id: PANE, title: paneTitle(shown), focus: true });
  scrollPane($, (await following($)) ? "end" : "start");
}

/** The pane's title: whose record it shows, when it shows one. */
const paneTitle = (shown: OpenplanRecord | null) =>
  shown ? `${PLUGIN} · ${shown.member}` : PLUGIN;

/**
 * Whether the pane shows what keeps coming, the meeting or a member's
 * record: shown from its end, where it keeps up the way the transcript does;
 * scrolling away lets it go, scrolling back to the end keeps it again (the
 * `ui.scroll` hook). Anything else shows from its start.
 */
async function following($: $) {
  const shown = await read($, tab);
  return shown === "meeting" || (shown === "team" && (await read($, record)) !== null);
}

/** Shows a tab, leaving the record it showed. */
async function showTab($: $, shown: OpenplanTab) {
  await update($, tab, () => shown);
  await showRecord($, null);
}

/** Shows a member's record in place of the team, or (null) the team again. */
async function showRecord($: $, shown: OpenplanRecord | null) {
  const was = await read($, record);
  await update($, record, () => shown);
  if (was?.member !== shown?.member) await $.ui.open({ id: PANE, title: paneTitle(shown) });
  scrollPane($, (await following($)) ? "end" : "start");
}

/** Moves the pane's window; one the engine can't move stays where it is, all a scroll can lose. */
function scrollPane($: $, to: "start" | "end") {
  $.ui.scroll({ in: PANE, to }).catch(() => undefined);
}

/** Answers a need as it was pressed; what the team refuses is shown. */
async function answer($: $, need: OpenplanNeed, args: Record<string, unknown>) {
  try {
    await call($, "answer", { question: need.id, ...args });
  } catch (error) {
    $.ui.toast(`openplan: ${words(error)}`);
  }
}

/**
 * Tells what is new: each need not asked yet is asked, in turn, but a task to
 * accept, which is your session's to ask; since the last look, a row for a
 * milestone and a prompt to your session for what needs a conversation.
 */
function tell($: $, now: OpenplanTeam) {
  for (const need of now.needs) {
    if (asked.has(need.id) || !need.ask) continue;
    asked.add(need.id);
    asking = asking.then(() => askNeed($, need));
  }
  const keys = [...now.milestones.map((m) => m.key), ...now.prompts.map((p) => p.key)];
  const fresh = takenUp !== undefined && now.goal?.slug === takenUp;
  if (fresh) takenUp = undefined;
  if (told || fresh) {
    if (!fresh)
      for (const milestone of now.milestones)
        if (!told?.has(milestone.key)) $.ui.log(`openplan: ${milestone.text}`);
    for (const prompt of now.prompts)
      if (!told?.has(prompt.key))
        $.prompt.submit({ text: prompt.text }).catch((error: unknown) => {
          $.ui.toast(`openplan: your session couldn't be told: ${words(error)}`);
        });
  }
  told = new Set([...(told ?? []), ...keys]);
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
    const now = await view($, {
      ...(revision !== undefined && { revision }),
      ...(following && { record: { subtask: following.subtask, from: following.next } }),
    });
    revision = now.revision;
    await update($, problem, () => null);
    if (now.team) {
      // Kept first: an ask looks there for whether its need is still open.
      await update($, team, () => now.team ?? null);
      tell($, now.team);
    }
    const said = now.speaking ?? null;
    await update($, speaking, (was) => (JSON.stringify(was) === JSON.stringify(said) ? was : said));
    await update($, record, (was) => followed(was, now));
  } catch (error) {
    // A server still starting is asked again; goals it can't read wait for you.
    if (error instanceof Refused) {
      ticking?.cancel();
      ticking = undefined;
      await update($, team, () => null);
    }
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
          {meeting.about} · {meeting.status}
        </Text>
        <Text dimColor>
          {meeting.participants.join(", ")}, hosted by {meeting.host}
        </Text>
        <Markdown key="agenda" text={meeting.agenda} dimColor />
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
          {runRows(ui, "speaking", live.entries, live.live)}
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

/** A tool call's row: its name and main argument, then the first lines of what it gave. */
function toolRow(
  ui: Ui,
  key: string,
  call: OpenplanCall & { state?: "done" | "error"; output?: string },
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

function entryRow(ui: Ui, entry: OpenplanEntry, key: string) {
  const { Text } = ui;
  switch (entry.kind) {
    case "run":
      return (
        <Text key={key} dimColor>
          ── a run on {entry.model}
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
          · {entry.notice.kind}
        </Text>
      );
  }
}

/**
 * What a run did and does, as a transcript shows it: a member's record and a
 * meeting turn being spoken alike. `key` keeps one's rows apart from another's.
 */
function runRows(ui: Ui, key: string, entries: OpenplanEntry[], live: OpenplanLive | undefined) {
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

/** A member's record in place of the team: what their runs did, then what goes on now. */
function recordPage($: $, ui: Ui, now: OpenplanTeam, shown: OpenplanRecord) {
  const { Box, Button, Text } = ui;
  const member = now.members.find((m) => m.name === shown.member);
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Box gap={1}>
          <Button key="back" label="Back" hotkey="b" onPress={() => showRecord($, null)} />
          <Text bold>{shown.member}</Text>
          {member && <Text dimColor>{memberLine(member)}</Text>}
        </Box>
        {member && <Text>{member.doing}</Text>}
      </Box>
      {runRows(ui, "record", shown.entries, shown.live)}
    </Box>
  );
}

/** A member's role, model and tokens, in a line. */
const memberLine = (member: OpenplanTeam["members"][number]) =>
  `${member.role}${member.model ? ` · ${member.model}` : ""} · ${member.tokens.toLocaleString()} tokens`;

function teamTab($: $, ui: Ui, now: OpenplanTeam) {
  const { Box, Button, Text } = ui;
  return (
    <Box flexDirection="column" gap={1}>
      {now.members.map((member) => {
        const { subtask } = member;
        const name = [
          <Text key="name" bold>
            {member.name}
          </Text>,
          <Text key="line" dimColor>
            {" "}
            {memberLine(member)}
          </Text>,
        ];
        return (
          <Box key={`m-${member.name}`} flexDirection="column">
            {subtask ? (
              <Button
                key={`follow-${member.name}`}
                plain
                onPress={() =>
                  showRecord($, { member: member.name, subtask, entries: [], next: 0 })
                }
              >
                {name}
              </Button>
            ) : (
              <Text>{name}</Text>
            )}
            <Text>{member.doing}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

async function needView($: $, ui: Ui, need: OpenplanNeed) {
  const { Box, Button, Input, Markdown, Select, Text } = ui;
  const head = (
    <Box flexDirection="column">
      <Text bold>{need.headline}</Text>
      {need.detail && <Markdown key={`t-${need.id}`} text={need.detail} />}
    </Box>
  );
  const mine = await read($, picks);
  if (need.kind === "choices") {
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
  const { note, sendBack } = need;
  const noteLabel = note && need.options.find((o) => o.value === note.option)?.label;
  // A revised task goes back to the subtask that asked, unless you pick another.
  const [back] = mine[`${need.id}:back`] ?? [];
  return (
    <Box key={`n-${need.id}`} flexDirection="column">
      {head}
      <Box gap={1}>
        {pickable(need).map((option) => (
          <Button
            key={`${need.id}-${option.value}`}
            label={option.label}
            variant={option.primary ? "primary" : "secondary"}
            onPress={() => answer($, need, { option: option.value })}
          />
        ))}
      </Box>
      {note && sendBack && sendBack.length > 1 && (
        <Select
          key={`${need.id}-back`}
          label={noteLabel}
          options={sendBack.map((s) => ({ value: s.id, label: s.title }))}
          value={back}
          onSelect={(value) =>
            update($, picks, (all) => ({ ...all, [`${need.id}:back`]: [value] }))
          }
        />
      )}
      {note && (
        <Input
          key={`${need.id}-note`}
          placeholder={note.prompt}
          submitLabel={noteLabel}
          onSubmit={(text) =>
            answer($, need, { option: note.option, note: text, ...(back && { sent_back: back }) })
          }
        />
      )}
    </Box>
  );
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
      description:
        "Hand openplan's team a task; with none, show the team in a pane; `/openplan status` prints where it stands, `pause` pauses this session's goal and `resume` resumes it or takes up another",
      argumentHint: "[task | status | pause | resume [number]]",
    });
    watch($);
    return next(e);
  });

  on("command.run", { command: "openplan" }, async ($, e) => {
    watch($);
    const task = e.args.trim();
    // Certain, so said without a model turn.
    const certain: Record<string, () => Promise<string>> = {
      status: () => call($, "status"),
      pause: () => call($, "goal_action", { action: "pause" }),
      resume: () => resumeGoal($),
    };
    const numbered = /^resume\s+(\d+)$/.exec(task);
    const run = numbered ? () => resumeGoal($, Number(numbered[1])) : certain[task];
    if (run) {
      try {
        return { text: await run() };
      } catch (error) {
        return { text: `openplan: ${words(error)}` };
      }
    }
    if (!task) {
      await openPane($);
      return {};
    }
    let text: string;
    try {
      text = await call($, "hand_off", { task });
    } catch (error) {
      return { text: `openplan: ${words(error)}` };
    }
    // Once the command is done: a prompt submitted while it runs would wait on it.
    $.clock.after(0, () => {
      $.prompt.submit({ text }).catch((error: unknown) => {
        $.ui.toast(`openplan: your session couldn't be given the task: ${words(error)}`);
      });
    });
    return {};
  });

  // Your session at the team: it may have one to open now.
  on("tool.call", { tool: TOOLS }, async ($, e, next) => {
    const result = await next(e);
    watch($);
    return result;
  });

  // The pane's tools are the person's: the model never answers a permission for
  // them. The mod's own calls (`$.mcp.call`) are checked too, and go on.
  on("tool.check", { tool: PANE_ONLY }, ($, e, next) =>
    next.origin.plugin === PLUGIN ? next(e) : { decision: "deny", reason: PANE_ONLY_REASON },
  ).catch(() => ({ decision: "deny", reason: PANE_ONLY_REASON }));
  on("tool.describe", { tool: PANE_ONLY }, async ($, e, next) => ({
    ...(await next(e)),
    isDeferred: true,
  }));

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const now = await read($, team);
    if (!now?.band || e.props.hasSurvey) return next(e);
    // Plain text, not a button: a button above the prompt takes ctrl+x and tab before the pane does.
    const { Box, Text } = $.ui.resolve(e);
    return (
      <Box flexDirection="column">
        <Text dimColor>openplan · {now.band}</Text>
        {now.tasks.map((line, i) => (
          <Text key={`task-${String(i)}`} dimColor>
            {"  "}
            {line}
          </Text>
        ))}
      </Box>
    );
  });

  on("ui.scroll", { requestId: PANE, origin: { kind: "person" } }, async ($, e, next) => {
    const moved = await next(e);
    if (e.offset >= e.contentRows - e.bodyRows && (await following($))) scrollPane($, "end");
    return moved;
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const ui: Ui = $.ui.resolve(e);
    const { Box, Button, Text } = ui;
    const now = await read($, team);
    const why = await read($, problem);
    if (!now) return <Text dimColor>{why ?? "Looking for the repository's goals…"}</Text>;
    if (!now.goal)
      return (
        <Box flexDirection="column" gap={1}>
          <Text>{now.noGoal}</Text>
          {now.resumable.map((goal) => (
            <Text key={`goal-${goal.slug}`} dimColor>
              {goal.label}
            </Text>
          ))}
          {why && <Text color="red">{why}</Text>}
        </Box>
      );
    const shown = await read($, tab);
    const followed = shown === "team" ? await read($, record) : null;
    return (
      <Box flexDirection="column" gap={1}>
        <Box gap={1}>
          {TABS.map((t) => (
            <Button
              key={`tab-${t.tab}`}
              label={
                t.tab === "needs" && now.needs.length ? `${t.label} (${now.needs.length})` : t.label
              }
              hotkey={t.hotkey}
              variant={t.tab === shown ? "primary" : "secondary"}
              onPress={() => showTab($, t.tab)}
            />
          ))}
        </Box>
        {why && <Text color="red">{why}</Text>}
        {shown === "meeting"
          ? await meetingTab($, ui, now.meeting)
          : followed
            ? recordPage($, ui, now, followed)
            : shown === "team"
              ? teamTab($, ui, now)
              : await needsTab($, ui, now.needs)}
        <Text dimColor italic>
          {followed ? `b back to the team · ${KEYS}` : KEYS}
        </Text>
      </Box>
    );
  });
};
