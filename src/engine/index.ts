/**
 * The engine's one public surface: what the plugin runs a goal with, and
 * what it reads of one. The plugin imports nothing else of the engine (lint
 * enforces it).
 */
export type { Team } from "./core.ts";
export type { GoalEntry } from "./data.ts";
export { acceptanceOf, derive, inProgress, taskDone, toMerge, type Work } from "./derive.ts";
export { Engine, type EngineOptions, type HandedOver } from "./engine.ts";
export { GitError, goalBranch, SLUG } from "./git.ts";
export { planSchema, writtenPlan } from "./plan.ts";
export type { Answer } from "./questions.ts";
export { stopMembers } from "./processes.ts";
export type { LiveRun, RecordEntry } from "./records.ts";
export { RepositoryGoals } from "./repository.ts";
export { claudeFolder, shipTeam, switchInTeam, TeamError, userTeamFolder } from "./team.ts";
export type { Notice } from "./turns.ts";
export * from "./types.ts";
