// ---------- CONFIG ----------
const THRESHOLD = 0.18;   // RMS threshold for detection (higher = less sensitive)
const COOLDOWN_MS = 1200; // ignore triggers for this many ms after a burp
// ----------------------------

// Load burps from localStorage; handle both string timestamps and {timestamp}
let burps = JSON.parse(localStorage.getItem('burps') || '[]');
let audioContext, analyser, dataArray, micSource;
let lastTrigger = 0;

function getTimestampString(entry) {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object' && entry.timestamp) return entry.timestamp;
  return new Date().toISOString();
}

function initUI() {
  document.getElementById('manualBtn').addEventListener('click', playBurp);
  document.getElementById('startBtn').addEventListener('click', startDetection);
  updateDisplay();
}
window.addEventListener('load', initUI);

// ---------- main burp action ----------
function playBurp() {
  const audio = document.getElementById('burpAudio');
  audio.currentTime = 0;
  audio.play().catch(() => {});

  const timestamp = new Date().toISOString();
  // store as plain ISO strings for simplicity
  burps.push(timestamp);
  localStorage.setItem('burps', JSON.stringify(burps));

  updateDisplay();
  showRandomMessage();
  createEmoji();
  launchConfetti();
}

// ---------- UI updates ----------
function updateDisplay() {
  const today = new Date().toISOString().slice(0, 10);
  const count = burps.filter(b => getTimestampString(b).startsWith(today)).length;
  document.getElementById('burpCount').innerText = count;

  const list = document.getElementById('burpList');
  list.innerHTML = '';
  burps.slice().reverse().forEach((t) => {
    const ts = getTimestampString(t);
    const li = document.createElement('li');
    li.textContent = new Date(ts).toLocaleString();
    list.appendChild(li);
  });
}

function showRandomMessage() {
  const messages = [
    "💥 That one shook the Earth!",
    "Burp level: Expert 💨",
    "Oops, did you feel that one?",
    "☠️ Warning: Toxic zone detected!",
    "🏆 That burp deserves an award!",
    "😂 Another one? You okay?"
  ];
  const msg = messages[Math.floor(Math.random() * messages.length)];
  const el = document.getElementById('message');
  el.style.opacity = 0;
  el.innerText = msg;
  setTimeout(() => (el.style.opacity = 1), 80);
  setTimeout(() => (el.style.opacity = 0), 3500);
}

// ---------- emoji + confetti ----------
function createEmoji() {
  const emojis = ["💨","🤢","🤪","🫢","😝","😷","💥","😜"];
  const e = document.createElement('div');
  e.className = 'emoji';
  e.innerText = emojis[Math.floor(Math.random() * emojis.length)];
  e.style.left = Math.random() * 90 + 'vw';
  const xShift = (Math.random() * 80 - 40) + 'vw';
  e.style.setProperty('--x-shift', xShift);
  e.style.animationDuration = (3 + Math.random() * 3) + 's';
  document.getElementById('background').appendChild(e);
  setTimeout(() => e.remove(), 6000);
}

function launchConfetti() {
  const duration = 900;
  const end = Date.now() + duration;
  (function frame() {
    confetti({
      particleCount: 6,
      spread: 50,
      startVelocity: 30,
      origin: { x: Math.random(), y: Math.random() * 0.6 }
    });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}

// ---------- microphone detection ----------
async function startDetection() {
  const startBtn = document.getElementById('startBtn');
  startBtn.disabled = true;
  startBtn.innerText = 'Listening… (click again to stop)';

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    await audioContext.resume();
    micSource = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    dataArray = new Uint8Array(analyser.fftSize);
    micSource.connect(analyser);

    startBtn.onclick = () => stopDetection(startBtn);
    detectLoop();
  } catch (err) {
    console.error('Could not start microphone:', err);
    alert('Microphone access denied or not available. Please allow microphone permission and try again.');
    startBtn.disabled = false;
    startBtn.innerText = 'Start Listening (Enable mic & sound)';
  }
}

function stopDetection(startBtn) {
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close();
  }
  startBtn.disabled = false;
  startBtn.innerText = 'Start Listening (Enable mic & sound)';
  startBtn.onclick = startDetection;
}

function detectLoop() {
  analyser.getByteTimeDomainData(dataArray);

  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) {
    const v = (dataArray[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / dataArray.length);

  if (rms > THRESHOLD && Date.now() - lastTrigger > COOLDOWN_MS) {
    lastTrigger = Date.now();
    playBurp();
  }

  requestAnimationFrame(detectLoop);
}
