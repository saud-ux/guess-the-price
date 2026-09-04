const socket = io();

const screens = {
  join: document.getElementById('screen-join'),
  waiting: document.getElementById('screen-waiting'),
  guess: document.getElementById('screen-guess'),
  guessed: document.getElementById('screen-guessed'),
  playerResult: document.getElementById('screen-player-result'),
  playerGameover: document.getElementById('screen-player-gameover')
};

let playerName = '';
let roomCode = '';
let totalDuration = 20;
const pCircumference = 2 * Math.PI * 28;

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

function formatNumber(num) {
  return Number(num).toLocaleString('en-US');
}

// ─── Audio ───
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new AudioCtx();
  return audioCtx;
}

function playSubmit() {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 660;
    gain.gain.value = 0.07;
    osc.start();
    osc.frequency.linearRampToValueAtTime(880, ctx.currentTime + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.stop(ctx.currentTime + 0.15);
  } catch(e) {}
}

function playResult(isWin) {
  try {
    const ctx = getAudioCtx();
    if (isWin) {
      [523, 659, 784].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        gain.gain.value = 0.05;
        osc.start(ctx.currentTime + i * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.1 + 0.2);
        osc.stop(ctx.currentTime + i * 0.1 + 0.2);
      });
    } else {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 300;
      gain.gain.value = 0.04;
      osc.start();
      osc.frequency.linearRampToValueAtTime(200, ctx.currentTime + 0.2);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.stop(ctx.currentTime + 0.3);
    }
  } catch(e) {}
}

// Auto-fill room code from URL
const urlParams = new URLSearchParams(window.location.search);
const roomFromUrl = urlParams.get('room');
if (roomFromUrl) {
  document.getElementById('room-code-input').value = roomFromUrl;
}

// ─── Join ───
document.getElementById('btn-join').addEventListener('click', joinRoom);
document.getElementById('player-name-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoom();
});
document.getElementById('room-code-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('player-name-input').focus();
});

function joinRoom() {
  roomCode = document.getElementById('room-code-input').value.trim();
  playerName = document.getElementById('player-name-input').value.trim();

  if (!roomCode || roomCode.length !== 4) {
    showError('أدخل كود الغرفة (4 أرقام)');
    return;
  }
  if (!playerName) {
    showError('أدخل اسمك');
    return;
  }

  const btn = document.getElementById('btn-join');
  btn.disabled = true;
  btn.textContent = 'جاري الانضمام...';
  socket.emit('join-room', { roomCode, playerName });
}

function showError(msg) {
  const el = document.getElementById('join-error');
  el.textContent = msg;
  el.style.display = '';
}

socket.on('join-error', ({ message }) => {
  showError(message);
  const btn = document.getElementById('btn-join');
  btn.disabled = false;
  btn.textContent = 'انضم للعبة';
});

socket.on('join-success', ({ state, currentRound }) => {
  if (state === 'active' && currentRound) {
    document.getElementById('p-round-num').textContent = currentRound.number;
    document.getElementById('p-total-rounds').textContent = currentRound.totalRounds;
    document.getElementById('p-product-name').textContent = currentRound.productName;
    document.getElementById('p-currency').textContent = currentRound.currency;
    showScreen('guess');
    setTimeout(() => document.getElementById('guess-input').focus(), 100);
  } else {
    showScreen('waiting');
  }
});

// ─── Round started ───
socket.on('round-started', ({ roundNumber, totalRounds, productName, currency, duration }) => {
  totalDuration = duration;
  document.getElementById('p-round-num').textContent = roundNumber;
  document.getElementById('p-total-rounds').textContent = totalRounds;
  document.getElementById('p-product-name').textContent = productName;
  document.getElementById('p-currency').textContent = currency;
  document.getElementById('p-timer-value').textContent = duration;
  document.getElementById('p-timer-value').className = 'p-timer-num';
  document.getElementById('guess-input').value = '';
  document.getElementById('btn-submit-guess').disabled = false;

  const prog = document.getElementById('p-timer-progress');
  prog.style.strokeDashoffset = '0';
  prog.style.stroke = 'var(--gold)';

  showScreen('guess');
  setTimeout(() => document.getElementById('guess-input').focus(), 100);
});

// ─── Timer ───
socket.on('timer-tick', ({ remaining }) => {
  const el = document.getElementById('p-timer-value');
  if (el) el.textContent = remaining;

  const ratio = 1 - (remaining / totalDuration);
  const offset = pCircumference * ratio;
  const prog = document.getElementById('p-timer-progress');
  if (prog) {
    prog.style.strokeDashoffset = offset;
  }

  if (remaining <= 3) {
    el.className = 'p-timer-num danger';
    if (prog) prog.style.stroke = 'var(--red)';
  } else if (remaining <= 5) {
    el.className = 'p-timer-num warning';
    if (prog) prog.style.stroke = 'var(--gold)';
  }
});

// ─── Submit guess ───
document.getElementById('btn-submit-guess').addEventListener('click', submitGuess);
document.getElementById('guess-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitGuess();
});

function submitGuess() {
  const val = document.getElementById('guess-input').value.trim();
  if (!val || parseFloat(val) <= 0) {
    showToast('أدخل رقم صحيح');
    return;
  }
  document.getElementById('btn-submit-guess').disabled = true;
  socket.emit('submit-guess', { guess: val });
}

socket.on('guess-confirmed', ({ value }) => {
  document.getElementById('guessed-value').textContent = formatNumber(value);
  playSubmit();
  showScreen('guessed');
});

socket.on('guess-error', ({ message }) => {
  showToast(message);
  document.getElementById('btn-submit-guess').disabled = false;
});

// ─── Result ───
socket.on('your-result', ({ yourGuess, rank, difference, isOver, points, totalScore, didGuess }) => {
  const content = document.getElementById('p-result-content');
  const medals = ['🥇', '🥈', '🥉'];
  const rankLabels = ['الأقرب!', 'المركز الثاني!', 'المركز الثالث!'];

  if (!didGuess) {
    content.innerHTML = `
      <div style="font-size:3rem; margin-bottom:8px;">⚠️</div>
      <div class="p-result-title miss">لم تخمّن هذه الجولة</div>
      <div class="p-result-total">مجموع نقاطك</div>
      <div class="p-result-total-score">${totalScore} نقاط</div>
      <div class="p-result-footer"><div class="mini-spinner"></div> بانتظار الجولة التالية...</div>
    `;
    playResult(false);
  } else {
    const isWin = rank <= 3;
    const medal = isWin ? medals[rank - 1] : '';
    const diffArrow = isOver ? '↑' : '↓';
    const diffClass = isOver ? 'over' : 'under';
    const title = isWin ? rankLabels[rank - 1] : `المركز ${rank}`;
    const titleClass = isWin ? 'win' : 'miss';

    content.innerHTML = `
      ${medal ? `<div class="p-result-medal">${medal}</div>` : ''}
      <div class="p-result-title ${titleClass}">${title}</div>
      <div class="p-result-stats">
        <div class="p-result-stat">
          <div class="p-result-stat-label">تخمينك</div>
          <div class="p-result-stat-value">${formatNumber(yourGuess)}</div>
        </div>
        <div class="p-result-stat">
          <div class="p-result-stat-label">الفرق</div>
          <div class="p-result-stat-value ${diffClass}">${formatNumber(difference)} ${diffArrow}</div>
        </div>
      </div>
      ${points > 0 ? `<div class="p-result-points">+${points} نقاط</div>` : ''}
      <div class="p-result-total">مجموع نقاطك</div>
      <div class="p-result-total-score">${totalScore} نقاط</div>
      <div class="p-result-footer"><div class="mini-spinner"></div> بانتظار الجولة التالية...</div>
    `;
    playResult(isWin);
  }

  showScreen('playerResult');
});

socket.on('next-round-ready', () => {
  showScreen('waiting');
});

// ─── Game over ───
socket.on('game-over', ({ finalScores }) => {
  const myIndex = finalScores.findIndex(s => s.name === playerName);
  const content = document.getElementById('p-final-result');
  const medals = ['🥇', '🥈', '🥉'];
  const rankLabels = ['الأول', 'الثاني', 'الثالث'];

  let html = '<div class="p-gameover-title">انتهت اللعبة!</div>';

  if (myIndex >= 0 && myIndex < 3) {
    html += `
      <div class="p-gameover-medal">${medals[myIndex]}</div>
      <div class="p-gameover-rank">المركز ${rankLabels[myIndex]}!</div>
      <div class="p-gameover-score">${finalScores[myIndex].score} نقاط</div>
    `;
  } else if (myIndex >= 0) {
    html += `
      <div style="font-size:3rem; margin-bottom:12px;">🎮</div>
      <div class="p-gameover-rank">المركز ${myIndex + 1}</div>
      <div class="p-gameover-score">${finalScores[myIndex].score} نقاط</div>
    `;
  } else {
    html += '<div class="p-gameover-thanks">شكراً على المشاركة!</div>';
  }

  content.innerHTML = html;
  showScreen('playerGameover');
});

socket.on('game-reset', () => {
  showScreen('waiting');
});

socket.on('host-disconnected', () => {
  showToast('الهوست انقطع!');
  showScreen('join');
  const btn = document.getElementById('btn-join');
  btn.disabled = false;
  btn.textContent = 'انضم للعبة';
});
