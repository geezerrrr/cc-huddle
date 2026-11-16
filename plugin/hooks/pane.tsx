/**
 * cc-huddle's pane (docs/design.md §7.2): the meeting, the team, a member's
 * record in place of the team, and what needs you with the controls that
 * answer it. It opens only on your command or press.
 */
import type { EngineInterface } from "claude-code";
import type { HuddleMeeting, HuddleNeed, HuddleTab, HuddleTeam } from "../types";
import { runRows, type Ui } from "./rows";
import {
  PANE,
  PLUGIN,
  changeFollowed,
  changePicks,
  changeSentBack,
  readFollowed,
  readPicks,
  readProblem,
  readSentBack,
  readSpeaking,
  readTab,
  readTeam,
  keepTab,
} from "./state";
import { taskPlaces, words } from "./text";
import { answer, decide } from "./watch";

type $ = EngineInterface;

const TABS: { tab: HuddleTab; label: string; hotkey: string }[] = [
  { tab: "meeting", label: "Meeting", hotkey: "1" },
  { tab: "team", label: "Team", hotkey: "2" },
  { tab: "needs", label: "Needs you", hotkey: "3" },
];

/** The pane's title: whose record it shows, when it shows one. */
const paneTitle = (shown: { member: string } | null) =>
  shown ? `${PLUGIN} · ${shown.member}` : PLUGIN;

/** Moves the pane's window; one the engine won't move (`deny`) stays where it is, all a scroll can lose. */
export function scrollPane($: $, to: "start" | "end") {
  $.ui.scroll({ in: PANE, to }).catch((error: unknown) => {
    $.ui.toast(`cc-huddle: the pane couldn't scroll: ${words(error)}`);
  });
}

/**
 * Whether the pane shows what keeps coming, the meeting or a member's
 * record: shown from its end, where it keeps up the way the transcript does;
 * scrolling away lets it go, scrolling back to the end keeps it again (the
 * `ui.scroll` hook). Anything else shows from its start.
 */
export async function following($: $) {
  const shown = await readTab($);
  return shown === "meeting" || (shown === "team" && (await readFollowed($)) !== null);
}

/** Opens the pane with the keyboard: only ever on the person's command or press. */
export async function openPane($: $) {
  await $.ui.open({ id: PANE, title: paneTitle(await readFollowed($)), focus: true });
  scrollPane($, (await following($)) ? "end" : "start");
}

/** Shows a member's record in place of the team, or (null) the team again. */
async function follow($: $, member: string | null) {
  const was = await readFollowed($);
  const now = member === null ? null : { member };
  await changeFollowed($, () => now);
  if ((was?.member ?? null) !== member) await $.ui.open({ id: PANE, title: paneTitle(now) });
  scrollPane($, (await following($)) ? "end" : "start");
}

/** Closes the pane, as its close mark does. */
function closePane($: $) {
  $.ui.close({ id: PANE }).catch((error: unknown) => {
    $.ui.toast(`cc-huddle: the pane couldn't close: ${words(error)}`);
  });
}

/** The pane's last line: the keys that work on the page, Back to the team on the meeting and a member's record. */
function keysLine($: $, ui: Ui, back?: () => void) {
  const { Box, Button, Text } = ui;
  return (
    <Box gap={2}>
      <Text dimColor>↑/↓ scroll</Text>
      {back && <Button key="back" label="Back" hotkey="b" plain dimColor onPress={back} />}
      <Button key="close" label="Close" hotkey="x" plain dimColor onPress={() => closePane($)} />
    </Box>
  );
}

/** Shows a tab, leaving the record it showed. */
async function showTab($: $, shown: HuddleTab) {
  await keepTab($, shown);
  await follow($, null);
}

async function meetingTab($: $, ui: Ui, meeting: HuddleMeeting | undefined) {
  const { Box, Markdown, Text } = ui;
  if (!meeting) return <Text dimColor>No meeting yet: ask your session to hold one.</Text>;
  const live = await readSpeaking($);
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold>{meeting.heading}</Text>
        <Text dimColor>{meeting.attendance}</Text>
        <Markdown key="agenda" text={meeting.agenda} dimColor />
      </Box>
      {meeting.turns.map((turn, i) => (
        <Box key={`turn-${i}`} flexDirection="column">
          <Text bold>{turn.heading}</Text>
          <Markdown key={`said-${i}`} text={turn.text} />
        </Box>
      ))}
      {live && (
        <Box flexDirection="column">
          <Text bold>{live.speaker}</Text>
          {runRows(ui, "speaking", live.entries, live.live)}
        </Box>
      )}
      {meeting.hands && <Text dimColor>{meeting.hands}</Text>}
      {meeting.plan && <Text>{meeting.plan}</Text>}
    </Box>
  );
}

function teamTab($: $, ui: Ui, now: HuddleTeam) {
  const { Box, Button, Text } = ui;
  return (
    <Box flexDirection="column" gap={1}>
      {now.members.map((member) => {
        const name = [
          <Text key="name" bold>
            {member.name}
          </Text>,
          <Text key="line" dimColor>
            {" "}
            {member.line}
          </Text>,
        ];
        return (
          <Box key={`m-${member.name}`} flexDirection="column">
            {member.followable ? (
              <Button key={`follow-${member.name}`} plain onPress={() => follow($, member.name)}>
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

/** A member's record in place of the team: what their runs did, then what goes on now. */
async function recordPage($: $, ui: Ui, now: HuddleTeam, shown: string) {
  const { Box, Text } = ui;
  const member = now.members.find((m) => m.name === shown);
  const record = (await readFollowed($))?.record;
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Box gap={1}>
          <Text bold>{shown}</Text>
          {member && <Text dimColor>{member.line}</Text>}
        </Box>
        {member && <Text>{member.doing}</Text>}
      </Box>
      {runRows(ui, "record", record?.entries ?? [], record?.live)}
    </Box>
  );
}

async function needView($: $, ui: Ui, need: HuddleNeed) {
  const { Box, Button, Input, Markdown, Select, Text } = ui;
  const head = (
    <Box flexDirection="column">
      <Text bold>{need.headline}</Text>
      {need.detail && <Markdown key={`t-${need.id}`} text={need.detail} />}
    </Box>
  );
  const mine = await readPicks($);
  if (need.kind === "choices") {
    const chosen = mine[need.id] ?? [];
    // Answered once every question has its pick; `update` may run its closure again, so the answer waits for it.
    const pick = async (index: number, value: string) => {
      let all: string[] | undefined;
      await changePicks($, (was) => {
        const now = [...(was[need.id] ?? [])];
        now[index] = value;
        all = need.choices.every((_, i) => now[i] !== undefined) ? now : undefined;
        return { ...was, [need.id]: now };
      });
      if (all) await answer($, need, { kind: "choices", picks: all });
    };
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
                placeholder={`Any of: ${choice.options.map((o) => o.label).join(", ")}`}
                onSubmit={(value) => pick(i, value)}
              />
            ) : (
              <Select
                key={`${need.id}-${i}-one`}
                label={choice.header}
                options={choice.options.map((o) => ({
                  value: o.label,
                  label: o.description ? `${o.label}: ${o.description}` : o.label,
                }))}
                value={chosen[i]}
                onSelect={(value) => pick(i, value)}
              />
            )}
            {!choice.multiSelect && (
              <Input
                key={`${need.id}-${i}-other`}
                placeholder="Or type an answer"
                onSubmit={(value) => pick(i, value)}
              />
            )}
          </Box>
        ))}
      </Box>
    );
  }
  if (need.kind === "plan")
    return (
      <Box key={`n-${need.id}`} flexDirection="column" gap={1}>
        {head}
        <Box gap={1}>
          <Button
            key={`${need.id}-approve`}
            label="Approve"
            variant="primary"
            onPress={() => decide($, need, { decision: "approve" })}
          />
          <Button
            key={`${need.id}-drop`}
            label="Drop"
            onPress={() => decide($, need, { decision: "drop" })}
          />
        </Box>
        <Input
          key={`${need.id}-accept`}
          placeholder="Or the numbers of the tasks you accept yourself: 1, 3"
          submitLabel="Approve"
          onSubmit={(text) =>
            decide($, need, { decision: "approve", accept: taskPlaces(text, need.tasks.length) })
          }
        />
        <Input
          key={`${need.id}-change`}
          placeholder="Or what to change"
          submitLabel="Change"
          onSubmit={(text) => decide($, need, { decision: "change", change: text })}
        />
        <Markdown key={`doc-${need.id}`} text={need.document} />
      </Box>
    );
  const { note, sendBack } = need;
  // A revised task goes back to the subtask that asked, unless you pick another.
  const back = (await readSentBack($))[need.id];
  return (
    <Box key={`n-${need.id}`} flexDirection="column">
      {head}
      <Box gap={1}>
        {need.options.map((option) => (
          <Button
            key={`${need.id}-${option.value}`}
            label={option.label}
            variant={option.primary ? "primary" : "secondary"}
            onPress={() => answer($, need, { kind: "option", option: option.value })}
          />
        ))}
      </Box>
      {note && sendBack && (
        <Select
          key={`${need.id}-back`}
          label={note.label}
          options={sendBack.map((s) => ({ value: s.id, label: s.title }))}
          value={back}
          onSelect={(value) => changeSentBack($, (all) => ({ ...all, [need.id]: value }))}
        />
      )}
      {note && (
        <Input
          key={`${need.id}-note`}
          placeholder={note.prompt}
          submitLabel={note.label}
          onSubmit={(text) =>
            answer($, need, {
              kind: "option",
              option: note.option,
              note: text,
              ...(back && { sentBack: back }),
            })
          }
        />
      )}
    </Box>
  );
}

async function needsTab($: $, ui: Ui, needs: HuddleNeed[]) {
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

/** The pane as it stands: the tabs and the one shown, or why there is no goal. */
export async function paneView($: $, ui: Ui) {
  const { Box, Button, Text } = ui;
  const now = await readTeam($);
  const why = await readProblem($);
  if (!now) return <Text dimColor>{why ?? "Looking for the repository's goals…"}</Text>;
  if (now.noGoal !== undefined)
    return (
      <Box flexDirection="column" gap={1}>
        <Text>{now.noGoal}</Text>
        {now.resumable.map((goal) => (
          <Text key={`goal-${goal.slug}`} dimColor>
            {goal.label}
          </Text>
        ))}
        {why && <Text color="red">{why}</Text>}
        {keysLine($, ui)}
      </Box>
    );
  const shown = await readTab($);
  const member = shown === "team" ? (await readFollowed($))?.member : undefined;
  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={2}>
        {TABS.map((t) => (
          <Button
            key={`tab-${t.tab}`}
            label={
              t.tab === "needs" && now.needs.length ? `${t.label} (${now.needs.length})` : t.label
            }
            hotkey={t.hotkey}
            plain
            dimColor={t.tab !== shown}
            onPress={() => showTab($, t.tab)}
          />
        ))}
      </Box>
      {why && <Text color="red">{why}</Text>}
      {shown === "meeting"
        ? await meetingTab($, ui, now.meeting)
        : member !== undefined
          ? await recordPage($, ui, now, member)
          : shown === "team"
            ? teamTab($, ui, now)
            : await needsTab($, ui, now.needs)}
      {keysLine(
        $,
        ui,
        member !== undefined
          ? () => follow($, null)
          : shown === "meeting"
            ? () => showTab($, "team")
            : undefined,
      )}
    </Box>
  );
}
