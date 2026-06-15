const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')
const archiver = require('archiver')

const app = express()
const PORT = process.env.PORT || 3333
const DATA_DIR = path.join(__dirname, 'data')
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions')
const PHOTOS_DIR = path.join(__dirname, 'photos')

for (const dir of [DATA_DIR, SESSIONS_DIR, PHOTOS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true})
}

app.use(cors())
app.use(express.json({limit: '30mb'}))
app.use(express.static(path.join(__dirname, 'public')))
app.use('/photos', express.static(PHOTOS_DIR))

// ─── Matrix constants (mirrored from lens script) ─────────────────────────────

const MATRIX_RESOLUTIONS = [256, 512, 640, 756]
const MATRIX_COMP_KEYS   = ['maxComp', 'low', 'medium', 'high', 'maxQual']
const COMP_LABELS = {
  maxComp: 'Max Compress', low: 'Low', medium: 'Medium',
  high: 'High', maxQual: 'Max Quality',
}

// ─── Persistence ──────────────────────────────────────────────────────────────

function sessionFile(id) {
  return path.join(SESSIONS_DIR, id + '.json')
}
function saveSession(s) {
  fs.writeFileSync(sessionFile(s.id), JSON.stringify(s, null, 2))
}
function loadAllSessions() {
  if (!fs.existsSync(SESSIONS_DIR)) return {}
  return fs.readdirSync(SESSIONS_DIR)
    .filter(f => f.endsWith('.json'))
    .reduce((acc, f) => {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8'))
        acc[s.id] = s
      } catch {}
      return acc
    }, {})
}

const sessions = loadAllSessions()
console.log('[startup] Loaded ' + Object.keys(sessions).length + ' session(s)')

// ─── Stats ────────────────────────────────────────────────────────────────────

function roundStats(round) {
  if (!round?.frames?.length) return null
  const {frames, startedAt, endedAt} = round
  const durationMs = (endedAt || Date.now()) - startedAt
  const durationS  = durationMs / 1000
  const n   = frames.length
  const fps = n / durationS
  const totalKb = frames.reduce((s, f) => s + (f.sizeKb || 0), 0)
  const intervals = frames.slice(1).map((f, i) => f.timestamp - frames[i].timestamp)
  return {
    totalFrames:    n,
    durationS:      +durationS.toFixed(1),
    fps:            +fps.toFixed(2),
    framesPerMin:   +(fps * 60).toFixed(1),
    avgSizeKb:      +(totalKb / n).toFixed(1),
    totalDataMb:    +(totalKb / 1024).toFixed(2),
    minIntervalMs:  intervals.length ? Math.min(...intervals) : 0,
    maxIntervalMs:  intervals.length ? Math.max(...intervals) : 0,
  }
}

function buildMatrix(session) {
  const cells = {}
  for (const res of MATRIX_RESOLUTIONS) {
    for (const comp of MATRIX_COMP_KEYS) {
      const key   = res + '_' + comp
      const round = session.rounds[key]
      cells[key]  = round ? {
        ...roundStats(round),
        active: session.currentRound === key,
        started: !!round.startedAt,
        ended:   !!round.endedAt,
      } : null
    }
  }
  return {
    resolutions: MATRIX_RESOLUTIONS,
    compressions: MATRIX_COMP_KEYS,
    compLabels: COMP_LABELS,
    cells,
  }
}

function sessionView(s, includeLastFrames = false) {
  const view = {
    id: s.id, startedAt: s.startedAt, endedAt: s.endedAt,
    active: s.active, currentRound: s.currentRound || null,
    sessionType: s.sessionType || 'quality',
  }
  if (s.sessionType === 'matrix') {
    view.matrix = buildMatrix(s)
    if (includeLastFrames) {
      // Send last frame per round so the frontend can render thumbnails
      const lastFrames = {}
      for (const [key, round] of Object.entries(s.rounds)) {
        if (round?.frames?.length) {
          const last = round.frames[round.frames.length - 1]
          lastFrames[key] = `/photos/${s.id}/${key}/${last.filename}`
        }
      }
      view.lastFrames = lastFrames
    }
  } else {
    const rStats = {}
    for (const q of ['low', 'medium', 'high', 'full']) {
      rStats[q] = s.rounds?.[q] ? roundStats(s.rounds[q]) : null
    }
    view.qualityStats = rStats
  }
  return view
}

// ─── Session lifecycle ────────────────────────────────────────────────────────

app.post('/session/start', (req, res) => {
  const {sessionId, sessionType} = req.body
  if (!sessionId) return res.status(400).json({error: 'Missing sessionId'})

  for (const s of Object.values(sessions)) {
    if (s.active) { s.active = false; s.endedAt = Date.now(); saveSession(s) }
  }

  const session = {
    id: sessionId, startedAt: Date.now(), endedAt: null,
    active: true, currentRound: null,
    sessionType: sessionType || 'quality',
    rounds: {},
  }
  sessions[sessionId] = session
  saveSession(session)
  console.log('[session] Started: ' + sessionId + ' (' + session.sessionType + ')')
  res.status(201).json({ok: true})
})

app.post('/session/round-start', (req, res) => {
  const {sessionId, roundKey, resolution, compressionKey} = req.body
  const session = sessions[sessionId]
  if (!session) return res.status(404).json({error: 'Session not found'})

  const key = roundKey || (resolution + '_' + compressionKey)
  session.rounds[key] = {resolution, compressionKey, startedAt: Date.now(), endedAt: null, frames: []}
  session.currentRound = key
  saveSession(session)
  console.log('[round] Start: ' + key)
  res.status(201).json({ok: true})
})

app.post('/session/round-end', (req, res) => {
  const {sessionId, roundKey, quality} = req.body
  const session = sessions[sessionId]
  if (!session) return res.status(404).json({error: 'Session not found'})

  const key   = roundKey || quality
  const round = session.rounds[key]
  if (round) round.endedAt = Date.now()
  if (session.currentRound === key) session.currentRound = null
  saveSession(session)
  const stats = round ? roundStats(round) : null
  console.log('[round] End: ' + key + (stats ? ' — ' + stats.totalFrames + ' frames, ' + stats.fps + ' fps' : ''))
  res.status(200).json({ok: true, stats})
})

app.post('/session/end', (req, res) => {
  const {sessionId} = req.body
  const session = sessions[sessionId]
  if (!session) return res.status(404).json({error: 'Session not found'})
  session.active = false
  session.endedAt = Date.now()
  session.currentRound = null
  saveSession(session)
  console.log('[session] Ended: ' + sessionId)
  res.status(200).json({ok: true})
})

// ─── Upload ───────────────────────────────────────────────────────────────────

app.post('/upload', (req, res) => {
  const {sessionId, roundKey, quality, timestamp, image} = req.body
  const key = roundKey || quality
  if (!sessionId || !key || !image) return res.status(400).json({error: 'Missing fields'})

  const session = sessions[sessionId]
  if (!session) return res.status(404).json({error: 'Session not found'})

  const round = session.rounds[key]
  if (!round) return res.status(400).json({error: 'Round not started'})

  const ts       = timestamp || Date.now()
  const filename = 'frame_' + ts + '.jpg'
  const photoDir = path.join(PHOTOS_DIR, sessionId, key)
  if (!fs.existsSync(photoDir)) fs.mkdirSync(photoDir, {recursive: true})

  const buf = Buffer.from(image.replace(/^data:image\/\w+;base64,/, ''), 'base64')
  fs.writeFileSync(path.join(photoDir, filename), buf)

  const sizeKb = Math.round(buf.length / 102.4) / 10
  round.frames.push({timestamp: ts, filename, sizeKb})
  if (round.frames.length % 10 === 0) saveSession(session)

  res.status(201).json({ok: true, filename, sizeKb})
})

// ─── API ──────────────────────────────────────────────────────────────────────

app.get('/api/sessions', (req, res) => {
  const frames = req.query.frames === '1'
  res.json(
    Object.values(sessions)
      .map(s => sessionView(s, frames))
      .sort((a, b) => b.startedAt - a.startedAt)
  )
})

app.get('/api/session/:id', (req, res) => {
  const s = sessions[req.params.id]
  if (!s) return res.status(404).json({error: 'Not found'})
  res.json(sessionView(s))
})

app.get('/api/session/:id/download', (req, res) => {
  const s = sessions[req.params.id]
  if (!s) return res.status(404).json({error: 'Not found'})

  const sessionDir = path.join(PHOTOS_DIR, s.id)
  if (!fs.existsSync(sessionDir)) return res.status(404).json({error: 'No photos yet'})

  const date    = new Date(s.startedAt).toISOString().slice(0, 19).replace(/:/g, '-')
  const zipName = 'session_' + s.id + '_' + date + '.zip'

  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', 'attachment; filename="' + zipName + '"')

  const archive = archiver('zip', {zlib: {level: 0}})
  archive.on('error', err => { console.error('[zip]', err); res.destroy() })
  archive.pipe(res)

  // Add photos; each round is already in its own folder under sessionDir
  archive.directory(sessionDir, false)

  // stats summary
  const stats = {}
  for (const [key, round] of Object.entries(s.rounds)) {
    stats[key] = roundStats(round)
  }
  archive.append(
    JSON.stringify({sessionId: s.id, sessionType: s.sessionType, startedAt: s.startedAt, stats}, null, 2),
    {name: 'stats.json'}
  )
  archive.finalize()
})

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log('\nPokar backend → http://localhost:' + PORT)
  console.log('Set lens backendUrl to: http://<YOUR_IP>:' + PORT)
  console.log('(Find your IP: ifconfig | grep "inet " | grep -v 127)\n')
})
