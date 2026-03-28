# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

智谱API配额监控 — a VSCode extension that monitors Zhipu (智谱) API quota usage, displaying the 5-hour rolling quota consumption percentage, today/cumulative token usage, and next reset time in the status bar.

## Build & Development Commands

- **Compile**: `npm run compile` (runs `tsc -p ./`)
- **Watch**: `npm run watch` (runs `tsc -watch -p ./`)
- **Lint**: `npm run lint` (runs `eslint src --ext ts`)
- **Package VSIX**: `npx @vscode/vsce package --no-dependencies`
- **Debug**: Use the "Run Extension" launch config in VSCode (F5) — it runs the watch task as preLaunchTask

## Architecture

Single-file extension: all logic lives in [src/extension.ts](src/extension.ts).

**Key functions**:
- `activate()` — creates status bar item, registers 4 commands (`refresh`, `setApiKey`, `setRefreshInterval`, `resetCumulative`), sets up config change listener
- `fetchAndDisplayQuota()` — orchestrates quota fetch + today's token usage + cumulative backfill, updates status bar
- `httpsGet()` — HTTPS GET helper for `bigmodel.cn` with Bearer auth, 10s timeout
- `fetchQuota()` — calls `/api/monitor/usage/quota/limit` (extracts `TOKENS_LIMIT` type)
- `fetchModelUsage()` — calls `/api/monitor/usage/model-usage` (Beijing timezone, arbitrary time range)
- `updateStatusBar()` — renders status bar text with inline SVG progress bar (color-coded by usage %)
- `formatTokens()` — formats large token counts (>=1M → K, >=100M → M)

**Cumulative usage**: Stored in `globalState` as `{ lastDate, cumulativeUsage }`. On each refresh, if `lastDate < today`, fetches missing days' usage (max 30 days back) and accumulates. Displayed as `cumulativeUsage + todayUsage`.

**Configuration**: Two settings in `zhipuQuota` namespace — `apiKey` (string) and `refreshInterval` (number, default 300s).

**Activation event**: `onStartupFinished`.

## Conventions

- Language: Chinese for comments, UI strings, commit messages, and documentation
- Commit style: Conventional Commits in Chinese (`feat:`, `chore:`, etc.)
- No tests, no CI/CD
- VSIX packages are versioned and kept in the repo root (`zhipu-quota-<version>.vsix`)
- Zero runtime dependencies
