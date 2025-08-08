// Burp Challenge: Strength, Length, and Modes
let THRESHOLD = parseFloat(localStorage.getItem('burp_game_threshold') || '0.18');
const END_SILENCE_MS = 600;      // How long below threshold before burp ends
const MIN_BURP_MS = 250;         // Ignore tiny blips shorter than this

// Modes: endurance (duration), power (peak RMS), target (close to target RMS)
let mode = localStorage.getItem('burp_game_mode') || 'endurance';
let targetRMS = parseFloat(localStorage.getItem('burp_game_target') || '0.30');
let level = parseInt(localStorage.getItem('burp_game_level') || '1'); // 1-5

let audioContext, analyser, dataArray, micSource;
let listening = false;
let isBurping = false;
let burpStartTimeMs = 0;
let lastAboveTimeMs = 0;
let maxRMSThisBurp = 0;
let rafId = null;

let lastResult = null; // { durationMs, maxRMS, score, mode, targetRMS? }

// Scoreboard
const SCORE_KEY = 'burp_game_scores';
let scores = (() => { try { return JSON.parse(localStorage.getItem(SCORE_KEY) || '[]'); } catch { return []; } })();
let savedThisRound = false;

// UI elements
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const meterFill = document.getElementById('meterFill');
const currentRMSLabel = document.getElementById('currentRMS');
const maxRMSLabel = document.getElementById('maxRMS');
const currentDurationLabel = document.getElementById('currentDuration');
const bestDurationLabel = document.getElementById('bestDuration');
const playerNameInput = document.getElementById('playerName');
const saveScoreBtn = document.getElementById('saveScoreBtn');
const resetScoresBtn = document.getElementById('resetScoresBtn');
const scoreList = document.getElementById('scoreList');
const scoreValue = document.getElementById('scoreValue');
const modeSelect = document.getElementById('modeSelect');
const calibrateBtn = document.getElementById('calibrateBtn');
const thresholdValue = document.getElementById('thresholdValue');
const targetReadout = document.getElementById('targetReadout');
const targetValue = document.getElementById('targetValue');
const countdownOverlay = document.getElementById('countdownOverlay');
const countdownNum = document.getElementById('countdownNum');
const statusBadge = document.getElementById('statusBadge');
const levelSelect = document.getElementById('levelSelect');

// Visualizer
const vizCanvas = document.getElementById('vizCanvas');
const vizCtx = vizCanvas.getContext('2d');

renderScoreboard();
updateBestDurationFromScores();
updateModeUI();
thresholdValue.textContent = THRESHOLD.toFixed(2);
levelSelect.value = String(level);
updateStatus('ready');

// Prefill last name if available
playerNameInput.value = localStorage.getItem('burp_game_name') || playerNameInput.value;

startBtn.addEventListener('click', startRoundWithCountdown);
stopBtn.addEventListener('click', stopListening);
saveScoreBtn.addEventListener('click', saveScore);
resetScoresBtn.addEventListener('click', resetScores);
modeSelect.addEventListener('change', changeMode);
calibrateBtn.addEventListener('click', calibrateNoise);
levelSelect.addEventListener('change', changeLevel);

function changeMode() {
  mode = modeSelect.value;
  localStorage.setItem('burp_game_mode', mode);
  updateModeUI();
}

function changeLevel() {
  level = parseInt(levelSelect.value || '1');
  localStorage.setItem('burp_game_level', String(level));
  // Update target range immediately if in target mode
  if (mode === 'target') assignTargetForLevel();
}

function updateModeUI() {
  if (mode === 'target') {
    targetReadout.style.display = '';
    assignTargetForLevel();
  } else {
    targetReadout.style.display = 'none';
  }
}

function assignTargetForLevel() {
  // Level widens difficulty by making target narrower and higher
  // Target RMS ranges shift with level: base 0.20..0.60, higher levels favor higher target
  const minBase = 0.20 + (level - 1) * 0.05; // level 1 -> 0.20, level 5 -> 0.40
  const maxBase = 0.60; // cap
  const min = Math.min(maxBase - 0.05, minBase);
  const max = maxBase;
  targetRMS = min + Math.random() * (max - min);
  localStorage.setItem('burp_game_target', targetRMS.toFixed(2));
  targetValue.textContent = `${targetRMS.toFixed(2)} RMS`;
}

async function startRoundWithCountdown() {
  updateStatus('listening');
  await showCountdown(3);
  startListening();
}

function updateStatus(state) {
  statusBadge.className = 'status-badge';
  if (state === 'ready') {
    statusBadge.classList.add('status-ready');
    statusBadge.textContent = 'Ready';
  } else if (state === 'listening') {
    statusBadge.classList.add('status-listening');
    statusBadge.textContent = 'Listening';
  } else if (state === 'recording') {
    statusBadge.classList.add('status-recording');
    statusBadge.textContent = 'Recording';
  } else if (state === 'ended') {
    statusBadge.classList.add('status-ended');
    statusBadge.textContent = 'Ended';
  } else if (state === 'calibrating') {
    statusBadge.classList.add('status-calibrating');
    statusBadge.textContent = 'Calibrating…';
  }
}

function showCountdown(n) {
  return new Promise(resolve => {
    countdownOverlay.style.display = 'flex';
    let count = n;
    countdownNum.textContent = count.toString();
    const interval = setInterval(() => {
      count -= 1;
      if (count <= 0) {
        clearInterval(interval);
        countdownOverlay.style.display = 'none';
        resolve();
      } else {
        countdownNum.textContent = count.toString();
      }
    }, 800);
  });
}

async function startListening() {
  if (listening) return;
  startBtn.disabled = true;
  stopBtn.disabled = false;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    await audioContext.resume();
    micSource = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    dataArray = new Uint8Array(analyser.fftSize);
    micSource.connect(analyser);

    resetRound();
    listening = true;
    loop();
  } catch (err) {
    console.error('Mic error:', err);
    alert('Microphone access is required for the challenge.');
    startBtn.disabled = false;
    stopBtn.disabled = true;
    updateStatus('ready');
  }
}

function stopListening() {
  listening = false;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  if (rafId) cancelAnimationFrame(rafId);
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close();
  }
  updateStatus('ended');
}

function resetRound() {
  isBurping = false;
  burpStartTimeMs = 0;
  lastAboveTimeMs = 0;
  maxRMSThisBurp = 0;
  lastResult = null;
  savedThisRound = false;
  saveScoreBtn.disabled = true;
  saveScoreBtn.textContent = 'Save This Burp';
  maxRMSLabel.textContent = '0.00';
  currentDurationLabel.textContent = '0.00s';
  scoreValue.textContent = '0';
  clearViz();
}

function loop() {
  analyser.getByteTimeDomainData(dataArray);
  const now = performance.now();

  // Compute RMS
  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) {
    const v = (dataArray[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / dataArray.length);

  // Update meter
  currentRMSLabel.textContent = rms.toFixed(2);
  const width = Math.min(100, Math.round(rms * 300));
  meterFill.style.width = width + '%';

  // Draw waveform
  drawWaveform();

  // Burp state machine
  if (rms > THRESHOLD) {
    if (!isBurping) {
      // Start burp
      isBurping = true;
      burpStartTimeMs = now;
      maxRMSThisBurp = rms;
      updateStatus('recording');
    }
    lastAboveTimeMs = now;
    if (rms > maxRMSThisBurp) maxRMSThisBurp = rms;

    const durMs = now - burpStartTimeMs;
    currentDurationLabel.textContent = (durMs / 1000).toFixed(2) + 's';
    maxRMSLabel.textContent = maxRMSThisBurp.toFixed(2);
    scoreValue.textContent = computeScore(durMs, maxRMSThisBurp).toString();
  } else if (isBurping) {
    // If silence long enough, end burp
    if (now - lastAboveTimeMs > END_SILENCE_MS) {
      const durationMs = Math.max(0, lastAboveTimeMs - burpStartTimeMs);
      endBurp(durationMs, maxRMSThisBurp);
      isBurping = false;
      updateStatus('ended');
    } else {
      const durMs = Math.max(0, lastAboveTimeMs - burpStartTimeMs);
      currentDurationLabel.textContent = (durMs / 1000).toFixed(2) + 's';
      scoreValue.textContent = computeScore(durMs, maxRMSThisBurp).toString();
    }
  } else if (listening) {
    updateStatus('listening');
  }

  if (listening) rafId = requestAnimationFrame(loop);
}

function endBurp(durationMs, maxRMS) {
  // Ignore tiny blips
  if (durationMs < MIN_BURP_MS) {
    resetRound();
    return;
  }

  const score = computeScore(durationMs, maxRMS);
  lastResult = { durationMs, maxRMS, score, mode, targetRMS: mode === 'target' ? targetRMS : undefined };
  // Enable manual save
  saveScoreBtn.disabled = false;
  saveScoreBtn.textContent = 'Save This Burp';

  // Celebrate based on mode
  if (mode === 'endurance') {
    const best = getBestBy(r => r.durationMs);
    if (!best || durationMs > best.durationMs) celebrate();
  } else if (mode === 'power') {
    const best = getBestBy(r => r.maxRMS);
    if (!best || maxRMS > best.maxRMS) celebrate();
  } else if (mode === 'target') {
    const best = getBestBy(r => r.score);
    if (!best || score > best.score) celebrate();
  }
}

function computeScore(durationMs, maxRMS) {
  // Level multiplier: higher level -> higher scoring requirement, but we keep it as bonus multiplier to feel rewarding
  const levelMultiplier = 1 + (level - 1) * 0.25; // 1.00 .. 2.00

  if (mode === 'endurance') {
    // 1 point per 100ms, bonus for strength
    return Math.max(1, Math.round((durationMs / 100 + maxRMS * 20) * levelMultiplier));
  }
  if (mode === 'power') {
    // Emphasize strength
    return Math.max(1, Math.round(maxRMS * 200 * levelMultiplier));
  }
  if (mode === 'target') {
    // Higher score the closer maxRMS is to target; narrower window at higher levels
    const tightness = 1 + (level - 1) * 0.5; // 1 .. 3
    const diff = Math.abs(maxRMS - targetRMS); // 0 is perfect
    const base = 100 - Math.min(100, Math.round(diff * 200 * tightness)); // 100 when perfect, down to 0
    return Math.max(1, Math.round(base * levelMultiplier));
  }
  return 0;
}

function celebrate() {
  confetti({ particleCount: 90, spread: 70, origin: { x: 0.5, y: 0.6 } });
}

function saveScore() {
  if (!lastResult || savedThisRound) return;
  const name = (playerNameInput.value || localStorage.getItem('burp_game_name') || 'Player').trim().slice(0, 24) || 'Player';
  localStorage.setItem('burp_game_name', name);
  const entry = {
    name,
    mode: lastResult.mode,
    level,
    score: lastResult.score,
    durationMs: Math.round(lastResult.durationMs),
    maxRMS: Number(lastResult.maxRMS.toFixed(3)),
    targetRMS: lastResult.targetRMS ? Number(lastResult.targetRMS.toFixed(2)) : undefined,
    date: new Date().toISOString()
  };
  scores.push(entry);
  sortAndTrimScores();
  localStorage.setItem(SCORE_KEY, JSON.stringify(scores));
  renderScoreboard();
  updateBestDurationFromScores();
  savedThisRound = true;
  saveScoreBtn.disabled = true;
  saveScoreBtn.textContent = 'Saved ✓';
}

function resetScores() {
  if (!confirm('Reset all scores?')) return;
  scores = [];
  localStorage.removeItem(SCORE_KEY);
  renderScoreboard();
  updateBestDurationFromScores();
}

function sortAndTrimScores() {
  // Sort by score, then by duration, then by strength
  scores.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.durationMs !== a.durationMs) return b.durationMs - a.durationMs;
    return b.maxRMS - a.maxRMS;
  });
  if (scores.length > 10) scores.length = 10;
}

function getBestBy(selector) {
  if (scores.length === 0) return null;
  return scores.reduce((best, s) => (selector(s) > selector(best) ? s : best), scores[0]);
}

function getBestDuration() {
  if (scores.length === 0) return null;
  return scores.reduce((best, s) => (s.durationMs > best.durationMs ? s : best), scores[0]);
}

function updateBestDurationFromScores() {
  const best = getBestDuration();
  bestDurationLabel.textContent = best ? (best.durationMs / 1000).toFixed(2) + 's' : '0.00s';
}

function renderScoreboard() {
  scoreList.innerHTML = '';
  if (scores.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No scores yet — be the first!';
    scoreList.appendChild(li);
    return;
  }
  scores.forEach((s, i) => {
    const li = document.createElement('li');
    const left = document.createElement('span');
    const modeLabel = s.mode === 'endurance' ? '⏱️' : s.mode === 'power' ? '💥' : '🎯';
    const extra = s.mode === 'target' && s.targetRMS ? ` • target ${s.targetRMS.toFixed(2)}` : '';
    left.innerHTML = `<span class="rank">${i + 1}</span> L${s.level || 1} ${modeLabel} ${escapeHtml(s.name)}${extra}`;
    const right = document.createElement('span');
    right.textContent = `${s.score} pts • ${(s.durationMs / 1000).toFixed(2)}s • ${s.maxRMS.toFixed(2)} RMS`;
    li.appendChild(left);
    li.appendChild(right);
    scoreList.appendChild(li);
  });
}

function escapeHtml(str) {
  return str.replace(/[&<>\"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function calibrateNoise() {
  updateStatus('calibrating');
  // Sample ambient RMS for 1.5s and set threshold slightly above
  calibrateBtn.disabled = true;
  calibrateBtn.textContent = 'Calibrating…';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const source = ctx.createMediaStreamSource(stream);
    const a = ctx.createAnalyser();
    a.fftSize = 2048;
    const buffer = new Uint8Array(a.fftSize);
    source.connect(a);

    const endTime = performance.now() + 1500;
    let peak = 0;
    while (performance.now() < endTime) {
      a.getByteTimeDomainData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) {
        const v = (buffer[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buffer.length);
      if (rms > peak) peak = rms;
      await new Promise(r => setTimeout(r, 60));
    }

    await ctx.close();
    if (stream.getTracks) stream.getTracks().forEach(t => t.stop());

    // Set threshold 30% above ambient peak, clamp range
    THRESHOLD = Math.min(0.6, Math.max(0.08, peak * 1.3));
    localStorage.setItem('burp_game_threshold', THRESHOLD.toFixed(2));
    thresholdValue.textContent = THRESHOLD.toFixed(2);
  } catch (e) {
    alert('Calibration requires microphone access.');
  } finally {
    calibrateBtn.disabled = false;
    calibrateBtn.textContent = 'Calibrate Noise';
    updateStatus('ready');
  }
}

function drawWaveform() {
  const width = vizCanvas.width;
  const height = vizCanvas.height;
  vizCtx.clearRect(0, 0, width, height);

  // Background grid
  vizCtx.strokeStyle = 'rgba(0,0,0,0.06)';
  vizCtx.lineWidth = 1;
  for (let x = 0; x < width; x += 40) {
    vizCtx.beginPath();
    vizCtx.moveTo(x, 0);
    vizCtx.lineTo(x, height);
    vizCtx.stroke();
  }

  // Waveform
  vizCtx.strokeStyle = '#ff66cc';
  vizCtx.lineWidth = 2;
  vizCtx.beginPath();
  for (let i = 0; i < dataArray.length; i++) {
    const v = (dataArray[i] - 128) / 128; // -1..1
    const x = (i / (dataArray.length - 1)) * width;
    const y = height / 2 + v * (height / 2 - 6);
    if (i === 0) vizCtx.moveTo(x, y);
    else vizCtx.lineTo(x, y);
  }
  vizCtx.stroke();

  // Threshold line
  vizCtx.strokeStyle = 'rgba(255, 102, 204, 0.6)';
  vizCtx.setLineDash([6, 6]);
  vizCtx.beginPath();
  const thY = height / 2 - THRESHOLD * (height / 2 - 6);
  vizCtx.moveTo(0, thY);
  vizCtx.lineTo(width, thY);
  vizCtx.stroke();
  vizCtx.setLineDash([]);
}

function clearViz() {
  vizCtx.clearRect(0, 0, vizCanvas.width, vizCanvas.height);
} 