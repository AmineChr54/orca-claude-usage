// Claude Usage panel: draws the worker's latest reading. Countdowns tick locally every 30 s;
// the numbers themselves come from the worker (refreshed on its timer, or by the button).
const root = document.getElementById('root')
const updated = document.getElementById('updated')
const refreshButton = document.getElementById('refresh')
let data = null

// The Claude logo (claude-logo.png, shipped with the plugin).
function logo(size = 26) {
  return `<img src="claude-logo.png" width="${size}" height="${size}" alt="" />`
}

function esc(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

function timeLeft(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000))
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

// resets_at lands a few ms before the minute, so round to the nearest minute.
function resetDateTime(ms, clock) {
  const d = new Date(Math.round(ms / 60000) * 60000)
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} ${clockTime(d, clock)}`
}

function resetText(w, now, s) {
  if (!w.resetsAt || w.resetsAt <= now) return w.percent === 0 ? 'No active window' : ''
  const left = timeLeft(w.resetsAt - now)
  // The 5-hour window resets within hours: show time left and clock time. Weekly: date and time.
  return w.key === 'session'
    ? `Resets in ${left} · ${clockTime(new Date(Math.round(w.resetsAt / 60000) * 60000), s.clock)}`
    : `Resets ${resetDateTime(w.resetsAt, s.clock)} · in ${left}`
}

function limit(w, now, s) {
  const level = w.percent >= s.dangerAt ? 'danger' : w.percent >= s.warnAt ? 'warn' : ''
  const width = Math.max(w.percent > 0 ? 1.5 : 0, Math.min(100, w.percent))
  const sub = w.model ? ' sub' : ''
  return `<div class="limit ${level}${sub}">
    <div class="row"><span class="label">${esc(w.label)}</span><span class="pct">${Math.round(w.percent)}%</span></div>
    <div class="track" role="progressbar" aria-valuenow="${Math.round(w.percent)}" aria-valuemin="0" aria-valuemax="100"><div class="fill" style="width:${width}%"></div></div>
    <div class="muted">${esc(resetText(w, now, s))}</div>
  </div>`
}

function card(account, now, s) {
  const shown = account.windows.filter((w) => {
    if (w.key === 'session') return s.showSession
    if (w.key === 'weekly') return s.showWeekly
    return w.model && s.showModelLimits
  })
  const body = shown.map((w) => limit(w, now, s)).join('') || (account.error ? '' : '<p class="muted">No limits selected in settings.</p>')
  const note = account.error
    ? `<div class="error"><span>⚠</span><span>${esc(account.error)}${account.stale ? ` Showing the reading from ${esc(clockTime(new Date(account.at), s.clock))}.` : ''}</span></div>`
    : ''
  return `<section class="card">
    <div class="title">${logo()}<span class="name">${esc(account.label)}</span>${account.plan ? `<span class="badge">${esc(account.plan)}</span>` : ''}</div>
    ${body}${note}
  </section>`
}

function draw() {
  if (!data) return
  const now = Date.now()
  root.innerHTML = data.accounts.length
    ? data.accounts.map((a) => card(a, now, data.settings)).join('')
    : '<p class="muted">No accounts are switched on. Add one in this plugin\'s settings.</p>'
  updated.textContent = `Updated ${clockTime(new Date(data.at), data.settings.clock)}`
}

function show(next) {
  if (next) data = next
  draw()
}

async function load(force) {
  refreshButton.classList.add('spin')
  try {
    show(await orca.plugin.request('usage.get', { force }, { timeoutMs: 60000 }))
  } catch (err) {
    root.innerHTML = `<div class="error"><span>⚠</span><span>${esc(err.message ?? err)}</span></div>`
  } finally {
    refreshButton.classList.remove('spin')
  }
}

refreshButton.addEventListener('click', () => load(true))
orca.plugin.on('usage.update', show)
setInterval(draw, 30000)
load(false)
