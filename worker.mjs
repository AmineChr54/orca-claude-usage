// Claude Usage: shows the 5-hour and weekly limits of each configured Claude account in Orca's
// status bar. Reads each account's saved login (<config dir>/.credentials.json) and asks Claude's
// usage endpoint. It never refreshes or rewrites a login, so it cannot disturb a running `claude`.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const SLOTS = ['slot1', 'slot2', 'slot3', 'slot4']
const DEFAULTS = {
  accounts: 'Claude | claude | ~/.claude\nPersonal | claude | ~/.claude-work',
  showSession: true,
  showWeekly: true,
  showModelLimits: true,
  logo: '✻',
  bars: 'session',
  barWidth: 8,
  layout: 'full',
  clock: '24h',
  refreshMinutes: 3,
  warnAt: 70,
  dangerAt: 90
}

// ---- providers -------------------------------------------------------------------------------
// A provider turns an account into `{ windows: [{ key, label, percent, resetsAt }] }`.
// Add a provider here (e.g. gemini) and its name becomes valid in the Accounts setting.
const PROVIDERS = {
  async claude(account) {
    const dir = account.dir ? expandHome(account.dir) : join(homedir(), '.claude')
    let creds
    try {
      creds = JSON.parse(readFileSync(join(dir, '.credentials.json'), 'utf8')).claudeAiOauth
    } catch {
      throw new UsageError(`not signed in (no login found in ${dir})`)
    }
    if (!creds?.accessToken) throw new UsageError('not signed in')
    if (creds.expiresAt && creds.expiresAt < Date.now() - 60_000) {
      throw new UsageError('login expired: start this account in a terminal once to renew it')
    }
    const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'claude-cli/2.1 (orca claude-usage plugin)'
      },
      signal: AbortSignal.timeout(15_000)
    })
    if (!response.ok) throw new UsageError(`usage request failed (HTTP ${response.status})`)
    const data = await response.json()
    const windows = []
    const add = (key, label, w, model) => {
      if (!w || typeof w.utilization !== 'number') return
      windows.push({ key, label, model, percent: w.utilization, resetsAt: w.resets_at ? Date.parse(w.resets_at) : null })
    }
    add('session', '5-hour', data.five_hour)
    add('weekly', 'Weekly', data.seven_day)
    add('sonnet', 'Weekly Sonnet', data.seven_day_sonnet, true)
    add('opus', 'Weekly Opus', data.seven_day_opus, true)
    return { windows, plan: creds.subscriptionType ?? null }
  }
}

class UsageError extends Error {}

function expandHome(p) {
  p = p.trim()
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return resolve(p)
}

// ---- settings --------------------------------------------------------------------------------
async function readSettings(orca) {
  try {
    const { settings } = await orca.host.call('settings.get')
    return { ...DEFAULTS, ...Object.fromEntries(Object.entries(settings ?? {}).filter(([, v]) => v !== null && v !== undefined)) }
  } catch (err) {
    orca.log(`could not read settings, using defaults: ${err.message}`)
    return { ...DEFAULTS }
  }
}

function parseAccounts(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .slice(0, SLOTS.length)
    .map((line) => {
      const [label, provider, dir] = line.split('|').map((part) => part.trim())
      return { label: label || 'Claude', provider: (provider || 'claude').toLowerCase(), dir: dir || '' }
    })
}

// ---- formatting ------------------------------------------------------------------------------
function timeLeft(ms) {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours < 24) return rest ? `${hours}h ${rest}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  const h = hours % 24
  return h ? `${days}d ${h}h` : `${days}d`
}

function clockTime(date, clock) {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: clock === '12h' })
}

// "Thu 12 Nov 08:00" (resets_at is a few ms short of the minute, so round to the nearest minute).
function resetDateTime(ms, clock) {
  const rounded = new Date(Math.round(ms / 60_000) * 60_000)
  const day = rounded.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  return `${day} ${clockTime(rounded, clock)}`
}

function pct(value) {
  return `${Math.round(value)}%`
}

function tone(percent, s) {
  if (percent >= s.dangerAt) return 'danger'
  if (percent >= s.warnAt) return 'warning'
  return 'neutral'
}

function bar(percent, width) {
  let filled = Math.round((percent / 100) * width)
  if (percent > 0 && filled === 0) filled = 1 // never show a used limit as empty
  filled = Math.max(0, Math.min(width, filled))
  return '▰'.repeat(filled) + '▱'.repeat(width - filled)
}

function windowLine(w, now, s) {
  if (w.resetsAt && w.resetsAt > now) {
    return `${w.label}: ${pct(w.percent)} used, resets in ${timeLeft(w.resetsAt - now)} (${resetDateTime(w.resetsAt, s.clock)})`
  }
  return `${w.label}: ${pct(w.percent)} used${w.percent === 0 ? ', no active window' : ''}`
}

function render(account, result, now, s) {
  // Orca allows 64 characters: drop detail step by step until the text fits.
  const steps = [{}, { layout: 'compact' }, { layout: 'compact', barWidth: 5 }, { layout: 'compact', bars: 'none' }, { layout: 'compact', bars: 'none', logo: '' }]
  let view
  for (const step of steps) {
    view = renderOnce(account, result, now, { ...s, ...step })
    if (view.text.length <= 64) return view
  }
  return { ...view, text: view.text.slice(0, 63) + '…' }
}

function renderOnce(account, result, now, s) {
  const byKey = Object.fromEntries(result.windows.map((w) => [w.key, w]))
  const shown = []
  const parts = []
  const width = Math.min(16, Math.max(4, Number(s.barWidth) || 8))
  const showBar = (which) => s.bars === 'both' || (s.bars === 'session' && which === 'session')
  const session = s.showSession ? byKey.session : null
  const weekly = s.showWeekly ? byKey.weekly : null
  if (session) {
    shown.push(session)
    let part = `${showBar('session') ? bar(session.percent, width) + ' ' : ''}${pct(session.percent)} 5h`
    if (session.resetsAt && session.resetsAt > now) {
      part += s.layout === 'full' ? ` ↻${timeLeft(session.resetsAt - now)}` : ` ${timeLeft(session.resetsAt - now)}`
    }
    parts.push(part)
  }
  if (weekly) {
    shown.push(weekly)
    let part = `${showBar('weekly') ? bar(weekly.percent, width) + ' ' : ''}${pct(weekly.percent)} wk`
    if (weekly.resetsAt && weekly.resetsAt > now) {
      part += s.layout === 'full' ? ` ↻${resetDateTime(weekly.resetsAt, s.clock)}` : ` ${timeLeft(weekly.resetsAt - now)}`
    }
    parts.push(part)
  }
  const logo = String(s.logo ?? '').trim()
  const text = `${logo ? logo + ' ' : ''}${account.label} ${parts.join(' · ') || '(no limits selected)'}`
  const tooltipWindows = result.windows.filter((w) => (w.model ? s.showModelLimits : true))
  const tooltip = [`${account.label}${result.plan ? ` (${result.plan})` : ''}`, ...tooltipWindows.map((w) => windowLine(w, now, s))].join('\n')
  return { text, tooltip, tone: tone(Math.max(0, ...shown.map((w) => w.percent)), s) }
}

// ---- main loop -------------------------------------------------------------------------------
export default function activate(orca) {
  const last = new Map() // slot -> { key, result, at } of the last good reading
  let snapshot = null // what the sidebar panel draws
  let timer = null
  let running = null

  async function setSlot(id, fields) {
    await orca.host.call('statusBar.update', { id, visible: true, ...fields }).catch((err) => orca.log(`statusBar.update ${id}: ${err.message}`))
  }

  async function doRefresh() {
    let minutes = DEFAULTS.refreshMinutes
    try {
      const s = await readSettings(orca)
      minutes = Math.min(60, Math.max(1, Number(s.refreshMinutes) || DEFAULTS.refreshMinutes))
      const accounts = parseAccounts(s.accounts)
      const rows = await Promise.all(
        SLOTS.map(async (slot, i) => {
          const account = accounts[i]
          if (!account) {
            await orca.host.call('statusBar.update', { id: slot, visible: false }).catch(() => {})
            return null
          }
          const key = `${account.provider}|${account.dir}`
          const row = { label: account.label, provider: account.provider, plan: null, windows: [], error: null, stale: false, at: Date.now() }
          try {
            const provider = PROVIDERS[account.provider]
            if (!provider) throw new UsageError(`provider "${account.provider}" is not supported yet`)
            const result = await provider(account)
            last.set(slot, { key, result, at: Date.now() })
            row.plan = result.plan
            row.windows = result.windows
            await setSlot(slot, render(account, result, Date.now(), s))
          } catch (err) {
            const previous = last.get(slot)
            const reason = err instanceof UsageError ? err.message : `could not reach Claude (${err.message})`
            row.error = reason
            if (previous && previous.key === key && !(err instanceof UsageError)) {
              // Network hiccup: keep showing the last good numbers, marked stale.
              const view = render(account, previous.result, Date.now(), s)
              row.plan = previous.result.plan
              row.windows = previous.result.windows
              row.stale = true
              row.at = previous.at
              await setSlot(slot, { text: `${view.text} (old)`, tone: view.tone, tooltip: `${view.tooltip}

Last update failed: ${reason}` })
            } else {
              await setSlot(slot, { text: `${account.label}: ${err instanceof UsageError ? 'unavailable' : 'offline'}`, tone: 'warning', tooltip: `${account.label}
${reason}` })
            }
            orca.log(`${account.label}: ${reason}`)
          }
          return row
        })
      )
      const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback)
      snapshot = {
        at: Date.now(),
        settings: { clock: s.clock, warnAt: num(s.warnAt, 70), dangerAt: num(s.dangerAt, 90), showSession: !!s.showSession, showWeekly: !!s.showWeekly, showModelLimits: !!s.showModelLimits },
        accounts: rows.filter(Boolean)
      }
      snapshot = JSON.parse(JSON.stringify(snapshot)) // drops undefined, keeps it plain JSON
      orca.panels.post('usage.update', snapshot)
    } finally {
      clearTimeout(timer)
      timer = setTimeout(refresh, minutes * 60_000)
    }
  }

  function refresh() {
    running ??= doRefresh().finally(() => { running = null })
    return running
  }

  orca.commands.register('claudeUsage.refresh', () => {
    refresh()
    return null
  })
  // The panel asks for the latest reading; { force: true } re-reads now (its refresh button).
  orca.panels.handle('usage.get', async (input) => {
    if (input?.force || !snapshot) await refresh()
    return snapshot
  })
  refresh()
}
