# Claude Usage

An [Orca](https://github.com/stablyai/orca) plugin that shows the **5-hour** and **weekly** limits of
your Claude accounts, side by side, with exact reset times. Built for people with more than one
Claude subscription (for example a work and a personal account).

An unofficial community plugin, not affiliated with Anthropic.

- **Sidebar panel:** one card per account with the Claude logo, a progress bar per limit (orange,
  yellow from 70%, red from 90%) and live countdowns. The 5-hour limit shows the time left and the
  clock time; the weekly limit shows the date and time it resets.
- **Status bar:** a compact line per account, e.g. `✻ Personal ▰▱▱▱▱▱▱▱ 5% 5h ↻4h 31m · 95% wk ↻Mon 9 Nov 23:00`.
  Click it to refresh. (Plugin status bar items can only hold text, so the logo there is the `✻` symbol.)
- **Per-model weekly limits** (Sonnet, Opus) appear in the tooltip and panel for plans that have them.
- Up to 4 accounts. Orca's own Codex / Antigravity usage items are separate and can be hidden with
  right-click → **Hide from status bar**.

## Install

**From Git:** install from the Git URL `https://github.com/AmineChr54/orca-claude-usage`.

**From a local folder:**

```bash
git clone https://github.com/AmineChr54/orca-claude-usage
orca plugin dev load ./orca-claude-usage    # prints a fingerprint; re-run with --approve <fingerprint>
```

Open the panel from the bar-chart icon in the right sidebar, or run
`orca plugin open local.claude-usage --panel usage`.

Orca asks you to approve what the plugin can do:

- Run its own code in a separate Node.js process
- Read and change its own settings

## How it works

For each account the plugin reads the login Claude Code saved in that account's config folder
(`.credentials.json`) and asks Claude's usage endpoint (`api.anthropic.com/api/oauth/usage`).
Nothing is sent anywhere else. It never renews or rewrites a login, so it cannot interfere with a
running `claude`. If a login has expired, the account shows "unavailable"; start that account once in
a terminal to renew it. The endpoint is the one Claude Code itself uses and is not a documented public
API, so it could change.

## Settings

Settings → Plugins → Claude Usage:

| Setting | Default | What it does |
| --- | --- | --- |
| Accounts | `Claude \| claude \| ~/.claude` and `Personal \| claude \| ~/.claude-work` | One account per line: `Label \| provider \| config folder`. `#` switches a line off. |
| Show the 5-hour limit / weekly limit | on / on | Choose which limits to show |
| Show per-model weekly limits | on | Sonnet / Opus limits, when the plan has them |
| Logo before each account | `✻` | Status bar symbol; empty for none |
| Progress bars | 5-hour limit only | 5-hour only, both, or none (status bar) |
| Progress bar length | 8 | Status bar bar length |
| Status bar layout | Full | Full (with reset times) or compact |
| Clock for the weekly reset | 24-hour | 24-hour or 12-hour |
| Refresh every (minutes) | 3 | 1 to 60 |
| Turn yellow / red at (%) | 70 / 90 | Colour thresholds |

The config folder is where an account's `CLAUDE_CONFIG_DIR` points. The default account uses
`~/.claude`; a second account is usually a separate folder you set `CLAUDE_CONFIG_DIR` to.

## Adding other providers

Only `claude` is supported so far. A provider is one function in `worker.mjs` (`PROVIDERS`) that
returns `{ windows: [{ key, label, percent, resetsAt }] }`; once added, its name works in the
Accounts setting.

## License

MIT. The Claude logo belongs to Anthropic and is used here only to identify the service.
