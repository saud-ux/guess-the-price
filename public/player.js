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

// Audio
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
    gain.gain.value = 0.08;
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
        gain.gain.value = 0.06;
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
      gain.gain.value = 0.05;
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

// Join
document.getElementById('btn-join').addEventListener('click', joinRoom);
document.getElementById('player-name-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoom();
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

  document.getElementById('btn-join').disabled = true;
  document.getElementById('btn-join').textContent = 'جاري الانضمام...';
  socket.emit('join-room', { roomCode, playerName });
}

function showError(msg) {
  const el = document.getElementById('join-error');
  el.textContent = msg;
  el.style.display = '';
}

socket.on('join-error', ({ message }) => {
  showError(message);
  document.getElementById('btn-join').disabled = false;
  document.getElementById('btn-join').textContent = 'انضم';
});

socket.on('join-success', ({ state, currentRound }) => {
  if (state === 'active' && currentRound) {
    document.getElementById('p-round-num').textContent = currentRound.number;
    document.getElementById('p-total-rounds').textContent = currentRound.totalRounds;
    document.getElementById('p-product-name').textContent = currentRound.productName;
    document.getElementById('p-currency').textContent = currentRound.currency;
    showScreen('guess');
    document.getElementById('guess-input').focus();
  } else {
    showScreen('waiting');
  }
});

// Round started
socket.on('round-started', ({ roundNumber, totalRounds, productName, currency, duration }) => {
  document.getElementById('p-round-num').textContent = roundNumber;
  document.getElementById('p-total-rounds').textContent = totalRounds;
  document.getElementById('p-product-name').textContent = productName;
  document.getElementById('p-currency').textContent = currency;
  document.getElementById('p-timer-value').textContent = duration;
  document.getElementById('guess-input').value = '';
  document.getElementById('btn-submit-guess').disabled = false;

  const circle = document.getElementById('p-timer-circle');
  circle.className = 'timer-circle';
  circle.style.width = '60px';
  circle.style.height = '60px';
  circle.style.fontSize = '1.5rem';
  circle.style.borderWidth = '4px';

  showScreen('guess');
  setTimeout(() => document.getElementById('guess-input').focus(), 100);
});

// Timer
socket.on('timer-tick', ({ remaining }) => {
  const el = document.getElementById('p-timer-value');
  if (el) el.textContent = remaining;

  const circle = document.getElementById('p-timer-circle');
  if (remaining <= 3) {
    circle.className = 'timer-circle danger';
    circle.style.width = '60px';
    circle.style.height = '60px';
    circle.style.fontSize = '1.5rem';
    circle.style.borderWidth = '4px';
  } else if (remaining <= 5) {
    circle.className = 'timer-circle warning';
    circle.style.width = '60px';
    circle.style.height = '60px';
    circle.style.fontSize = '1.5rem';
    circle.style.borderWidth = '4px';
  }
});

// Submit guess
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

// Result
socket.on('your-result', ({ yourGuess, rank, difference, isOver, points, totalScore, didGuess }) => {
  const content = document.getElementById('p-result-content');
  const medals = ['🥇', '🥈', '🥉'];

  if (!didGuess) {
    content.innerHTML = `
      <div style="font-size:2rem; margin-bottom:8px;">⚠️</div>
      <div style="font-size:1.1rem; font-weight:700;">لم تخمّن هذه الجولة</div>
      <div style="margin-top:16px;">
        <div style="color:var(--text-muted);">مجموع نقاطك</div>
        <div style="font-size:1.4rem; font-weight:800; color:var(--gold);">${totalScore} نقاط</div>
      </div>
    `;
    playResult(false);
  } else {
    const medal = rank <= 3 ? medals[rank - 1] : '';
    const isWin = rank <= 3;
    const diffArrow = isOver ? '↑' : '↓';
    const diffColor = isOver ? 'var(--red)' : 'var(--green)';

    content.innerHTML = `
      ${medal ? `<div class="player-result-medal">${medal}</div>` : ''}
      ${isWin ? `<div style="font-size:1.2rem; font-weight:800; color:var(--green); margin-bottom:8px;">${rank === 1 ? 'الأقرب!' : rank === 2 ? 'المركز الثاني!' : 'المركز الثالث!'}</div>` : ''}
      <div style="margin:12px 0;">
        <div style="color:var(--text-muted); font-size:0.85rem;">تخمينك</div>
        <div style="font-size:1.4rem; font-weight:800;">${formatNumber(yourGuess)}</div>
      </div>
      <div style="margin:8px 0;">
        <div style="color:var(--text-muted); font-size:0.85rem;">الفرق</div>
        <div style="font-size:1.2rem; font-weight:700; color:${diffColor};">${formatNumber(difference)} ${diffArrow} ${isOver ? '❌' : ''}</div>
      </div>
      ${points > 0 ? `<div class="player-result-points">+${points} نقاط</div>` : ''}
      <div style="margin-top:16px;">
        <div style="color:var(--text-muted);">مجموع نقاطك</div>
        <div style="font-size:1.4rem; font-weight:800; color:var(--gold);">${totalScore} نقاط</div>
      </div>
    `;
    playResult(isWin);
  }

  showScreen('playerResult');
});

socket.on('next-round-ready', () => {
  showScreen('waiting');
});

// Game over
socket.on('game-over', ({ finalScores }) => {
  const myResult = finalScores.findIndex(s => s.name === playerName);
  const content = document.getElementById('p-final-result');
  const medals = ['🥇', '🥈', '🥉'];

  if (myResult >= 0 && myResult < 3) {
    content.innerHTML = `
      <div style="font-size:4rem; margin:16px 0;">${medals[myResult]}</div>
      <div style="font-size:1.4rem; font-weight:800; margin-bottom:8px;">المركز ${myResult === 0 ? 'الأول' : myResult === 1 ? 'الثاني' : 'الثالث'}!</div>
      <div style="font-size:1.6rem; font-weight:800; color:var(--gold);">${finalScores[myResult].score} نقاط</div>
    `;
  } else if (myResult >= 0) {
    content.innerHTML = `
      <div style="font-size:1.2rem; margin:16px 0;">المركز ${myResult + 1}</div>
      <div style="font-size:1.4rem; font-weight:800; color:var(--gold);">${finalScores[myResult].score} نقاط</div>
    `;
  } else {
    content.innerHTML = '<div style="margin:16px 0;">شكراً على المشاركة!</div>';
  }

  showScreen('playerGameover');
});

socket.on('game-reset', () => {
  showScreen('waiting');
});

socket.on('host-disconnected', () => {
  showToast('الهوست انقطع!');
  showScreen('join');
  document.getElementById('btn-join').disabled = false;
  document.getElementById('btn-join').textContent = 'انضم';
});
