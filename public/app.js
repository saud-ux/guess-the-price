const socket = io();

const screens = {
  lobby: document.getElementById('screen-lobby'),
  setup: document.getElementById('screen-setup'),
  active: document.getElementById('screen-active'),
  results: document.getElementById('screen-results'),
  gameover: document.getElementById('screen-gameover')
};

let currentScreen = 'lobby';
let roomCode = '';
let settings = { totalRounds: 10, roundDuration: 20, currency: '⃁' };
let currentRound = 0;
let totalDuration = 20;
const hostCircumference = 2 * Math.PI * 48;

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
  currentScreen = name;
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

function playTick() {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 800;
    gain.gain.value = 0.06;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    osc.stop(ctx.currentTime + 0.08);
  } catch(e) {}
}

function playReveal() {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = 523;
    gain.gain.value = 0.1;
    osc.start();
    osc.frequency.linearRampToValueAtTime(1047, ctx.currentTime + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.stop(ctx.currentTime + 0.3);
  } catch(e) {}
}

function playWin() {
  try {
    const ctx = getAudioCtx();
    [523, 659, 784, 1047].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      gain.gain.value = 0.06;
      osc.start(ctx.currentTime + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.2);
      osc.stop(ctx.currentTime + i * 0.12 + 0.2);
    });
  } catch(e) {}
}

function playCountdown() {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 440;
    gain.gain.value = 0.05;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
    osc.stop(ctx.currentTime + 0.1);
  } catch(e) {}
}

// ─── Create room ───
document.getElementById('btn-create-room').addEventListener('click', () => {
  socket.emit('create-room');
});

socket.on('room-created', (data) => {
  roomCode = data.roomCode;
  document.getElementById('room-code').textContent = roomCode;
  document.getElementById('room-info').style.display = '';
  document.getElementById('pre-room').style.display = 'none';
  document.getElementById('lobby-content').style.display = '';
  showToast('تم إنشاء الغرفة');
});

// ─── Copy links ───
document.getElementById('btn-copy-link').addEventListener('click', () => {
  const url = `${window.location.origin}/play.html?room=${roomCode}`;
  navigator.clipboard.writeText(url).then(() => showToast('تم نسخ رابط اللاعبين'));
});

document.getElementById('btn-copy-overlay').addEventListener('click', () => {
  const url = `${window.location.origin}/overlay.html?room=${roomCode}`;
  navigator.clipboard.writeText(url).then(() => showToast('تم نسخ رابط الأوفرلاي'));
});

// ─── Settings ───
document.getElementById('setting-rounds').addEventListener('change', (e) => {
  settings.totalRounds = parseInt(e.target.value);
  socket.emit('update-settings', settings);
});

document.getElementById('setting-duration').addEventListener('change', (e) => {
  settings.roundDuration = parseInt(e.target.value);
  socket.emit('update-settings', settings);
});

document.getElementById('setting-currency').addEventListener('change', (e) => {
  settings.currency = e.target.value;
  document.getElementById('currency-label').textContent = settings.currency;
  socket.emit('update-settings', settings);
});

document.getElementById('custom-currency').addEventListener('input', (e) => {
  if (e.target.value.trim()) {
    settings.currency = e.target.value.trim();
    document.getElementById('currency-label').textContent = settings.currency;
    socket.emit('update-settings', settings);
  }
});

// ─── Twitch ───
document.getElementById('btn-twitch-connect').addEventListener('click', () => {
  const channel = document.getElementById('twitch-channel').value.trim();
  if (!channel) return;
  socket.emit('connect-twitch', { channel });
  document.getElementById('btn-twitch-connect').disabled = true;
  document.getElementById('btn-twitch-connect').textContent = 'جاري الاتصال...';
});

socket.on('twitch-connected', ({ channel }) => {
  document.getElementById('twitch-status').style.display = 'flex';
  document.getElementById('twitch-dot').classList.add('connected');
  document.getElementById('twitch-status-text').textContent = `متصل بقناة ${channel}`;
  document.getElementById('btn-twitch-connect').textContent = 'قطع الاتصال';
  document.getElementById('btn-twitch-connect').disabled = false;
  document.getElementById('btn-twitch-connect').onclick = () => {
    socket.emit('disconnect-twitch');
  };
  showToast('تم الاتصال بتويتش');
});

socket.on('twitch-disconnected', () => {
  document.getElementById('twitch-status').style.display = 'none';
  document.getElementById('twitch-dot').classList.remove('connected');
  const btn = document.getElementById('btn-twitch-connect');
  btn.textContent = 'اتصال';
  btn.disabled = false;
  btn.onclick = null;
  btn.addEventListener('click', () => {
    const channel = document.getElementById('twitch-channel').value.trim();
    if (!channel) return;
    socket.emit('connect-twitch', { channel });
  });
});

socket.on('twitch-error', ({ message }) => {
  showToast(message);
  document.getElementById('btn-twitch-connect').textContent = 'اتصال';
  document.getElementById('btn-twitch-connect').disabled = false;
});

// ─── Players ───
socket.on('player-joined', ({ name, type, playerCount, players }) => {
  updatePlayerList(players);
  document.getElementById('player-count').textContent = playerCount;
  document.getElementById('btn-start-game').disabled = false;
  showToast(`${name} انضم`);
});

socket.on('player-left', ({ name, playerCount }) => {
  showToast(`${name} غادر`);
  document.getElementById('player-count').textContent = playerCount;
});

function updatePlayerList(players) {
  const list = document.getElementById('player-list');
  const noPlayers = document.getElementById('no-players');
  if (players.length === 0) {
    list.innerHTML = '';
    noPlayers.style.display = '';
    return;
  }
  noPlayers.style.display = 'none';
  list.innerHTML = players.map(p => `
    <div class="player-chip ${p.type}">
      <span class="icon">${p.type === 'twitch' ? '🟣' : '🌐'}</span>
      ${p.name}
    </div>
  `).join('');
}

// ─── Start game ───
document.getElementById('btn-start-game').addEventListener('click', () => {
  settings.totalRounds = parseInt(document.getElementById('setting-rounds').value);
  settings.roundDuration = parseInt(document.getElementById('setting-duration').value);
  const customCur = document.getElementById('custom-currency').value.trim();
  if (customCur) settings.currency = customCur;
  else settings.currency = document.getElementById('setting-currency').value;

  socket.emit('update-settings', settings);
  socket.emit('start-game');
});

socket.on('game-started', () => {
  currentRound = 0;
  document.getElementById('setup-round-num').textContent = '1';
  document.getElementById('setup-total-rounds').textContent = settings.totalRounds;
  document.getElementById('currency-label').textContent = settings.currency;
  document.getElementById('product-name').value = '';
  document.getElementById('actual-price').value = '';
  showScreen('setup');
});

// ─── Start round ───
document.getElementById('btn-start-round').addEventListener('click', () => {
  const productName = document.getElementById('product-name').value.trim();
  const actualPrice = document.getElementById('actual-price').value.trim();
  if (!productName) { showToast('اكتب اسم المنتج'); return; }
  if (!actualPrice || parseFloat(actualPrice) <= 0) { showToast('أدخل السعر'); return; }
  socket.emit('start-round', { productName, actualPrice: parseFloat(actualPrice) });
});

socket.on('round-started', ({ roundNumber, totalRounds, productName, currency, duration }) => {
  currentRound = roundNumber;
  totalDuration = duration;
  document.getElementById('active-round-num').textContent = roundNumber;
  document.getElementById('active-total-rounds').textContent = totalRounds;
  document.getElementById('active-product-name').textContent = productName;
  document.getElementById('active-currency').textContent = currency;
  document.getElementById('timer-value').textContent = duration;
  document.getElementById('timer-value').className = 'host-timer-num';
  document.getElementById('guess-count').textContent = '0';
  document.getElementById('guess-total').textContent = '0';

  const prog = document.getElementById('host-timer-progress');
  prog.style.strokeDashoffset = '0';
  prog.style.stroke = 'var(--gold)';

  showScreen('active');
});

socket.on('timer-tick', ({ remaining }) => {
  document.getElementById('timer-value').textContent = remaining;

  const ratio = 1 - (remaining / totalDuration);
  const offset = hostCircumference * ratio;
  const prog = document.getElementById('host-timer-progress');
  prog.style.strokeDashoffset = offset;

  const timerEl = document.getElementById('timer-value');
  if (remaining <= 3) {
    prog.style.stroke = 'var(--red)';
    timerEl.className = 'host-timer-num danger';
    playCountdown();
  } else if (remaining <= 5) {
    prog.style.stroke = 'var(--gold)';
    timerEl.className = 'host-timer-num warning';
  }
});

socket.on('guess-count-updated', ({ guessed, total }) => {
  document.getElementById('guess-count').textContent = guessed;
  document.getElementById('guess-total').textContent = total;
});

document.getElementById('btn-end-early').addEventListener('click', () => {
  socket.emit('end-round-early');
});

// ─── Round result ───
socket.on('round-result', (data) => {
  document.getElementById('result-round-num').textContent = data.roundNumber;
  document.getElementById('result-total-rounds').textContent = data.totalRounds;
  document.getElementById('result-product-name').textContent = data.productName;

  // Price reveal animation
  const priceStr = formatNumber(data.actualPrice);
  const container = document.getElementById('price-reveal');
  container.innerHTML = '';

  const chars = priceStr.split('');
  const digits = [];
  chars.forEach(ch => {
    const span = document.createElement('span');
    if (ch === ',') {
      span.className = 'price-digit comma';
      span.textContent = ',';
      span.style.opacity = '0';
    } else {
      span.className = 'price-digit';
      span.textContent = ch;
    }
    container.appendChild(span);
    digits.push(span);
  });

  const reversed = [...digits].reverse();
  reversed.forEach((digit, i) => {
    setTimeout(() => {
      digit.classList.add('revealed');
      digit.style.opacity = '1';
      if (!digit.classList.contains('comma')) playReveal();
    }, 300 + i * 250);
  });

  setTimeout(() => {
    const currSpan = document.createElement('span');
    currSpan.className = 'price-digit revealed';
    currSpan.textContent = ' ' + data.currency;
    currSpan.style.background = 'transparent';
    currSpan.style.opacity = '1';
    container.appendChild(currSpan);
  }, 300 + reversed.length * 250 + 200);

  setTimeout(() => {
    renderRankings(data);
    if (data.rankings.length > 0) playWin();
  }, 300 + reversed.length * 250 + 600);

  renderScoreboard(data.scores, 'scoreboard');

  const btnNext = document.getElementById('btn-next-round');
  if (data.isLastRound) {
    btnNext.textContent = 'عرض النتيجة النهائية';
    btnNext.onclick = () => showGameOver(data.scores);
  } else {
    btnNext.textContent = 'الجولة التالية';
    btnNext.onclick = () => {
      socket.emit('next-round');
    };
  }

  showScreen('results');
});

function renderRankings(data) {
  const list = document.getElementById('rankings-list');
  list.innerHTML = '';

  const under = data.rankings.filter(r => !r.isOver);
  const over = data.rankings.filter(r => r.isOver);

  const medals = ['🥇', '🥈', '🥉'];

  under.forEach(r => {
    const globalIndex = data.rankings.indexOf(r);
    list.appendChild(createResultItem(r, globalIndex, medals, data.currency));
  });

  if (over.length > 0) {
    const divider = document.createElement('div');
    divider.className = 'result-divider';
    divider.textContent = 'تجاوزوا السعر';
    list.appendChild(divider);

    over.forEach(r => {
      const globalIndex = data.rankings.indexOf(r);
      list.appendChild(createResultItem(r, globalIndex, medals, data.currency));
    });
  }

  if (data.didntGuess && data.didntGuess.length > 0) {
    const divider = document.createElement('div');
    divider.className = 'result-divider';
    divider.textContent = 'لم يخمّن';
    list.appendChild(divider);

    data.didntGuess.forEach(p => {
      const item = document.createElement('div');
      item.className = 'result-item';
      item.innerHTML = `
        <span class="result-rank">⚠️</span>
        <span class="result-name">${p.name}</span>
        <span style="color:var(--text-muted)">لم يخمّن</span>
      `;
      list.appendChild(item);
    });
  }
}

function createResultItem(r, globalIndex, medals, currency) {
  const item = document.createElement('div');
  item.className = `result-item ${globalIndex === 0 ? 'winner' : ''} ${r.isOver ? 'over' : ''}`;
  item.style.animationDelay = `${globalIndex * 0.08}s`;
  const medal = globalIndex < 3 ? medals[globalIndex] : `${globalIndex + 1}.`;
  const diffDir = r.isOver ? '↑' : '↓';
  const diffClass = r.isOver ? 'over' : 'under';

  item.innerHTML = `
    <span class="result-rank">${medal}</span>
    <span class="result-name">${r.name}</span>
    <span class="result-guess">${formatNumber(r.guess)} ${currency}</span>
    <span class="result-diff ${diffClass}">${formatNumber(r.difference)}${diffDir}</span>
    <span class="result-points">${r.points > 0 ? '+' + r.points + ' نقاط' : r.isOver ? '❌' : ''}</span>
  `;
  return item;
}

function renderScoreboard(scores, elementId) {
  const tbody = document.getElementById(elementId);
  tbody.innerHTML = scores.map((s, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1);
    return `<tr>
      <td class="rank-col">${medal}</td>
      <td>${s.name} ${s.type === 'twitch' ? '🟣' : '🌐'}</td>
      <td class="score-col">${s.score}</td>
    </tr>`;
  }).join('');
}

socket.on('next-round-ready', ({ roundNumber, totalRounds }) => {
  document.getElementById('setup-round-num').textContent = roundNumber;
  document.getElementById('setup-total-rounds').textContent = totalRounds;
  document.getElementById('product-name').value = '';
  document.getElementById('actual-price').value = '';
  showScreen('setup');
});

// ─── Game over ───
function showGameOver(scores) {
  const podium = document.getElementById('final-podium');
  const medals = ['🥇', '🥈', '🥉'];
  const classes = ['first', 'second', 'third'];

  const order = [1, 0, 2];
  podium.innerHTML = '';

  order.forEach(idx => {
    if (scores[idx]) {
      const s = scores[idx];
      const div = document.createElement('div');
      div.className = `podium-item ${classes[idx]}`;
      div.innerHTML = `
        <div class="podium-medal">${medals[idx]}</div>
        <div class="podium-name">${s.name}</div>
        <div class="podium-score">${s.score} نقاط</div>
      `;
      podium.appendChild(div);
    }
  });

  renderScoreboard(scores, 'final-scoreboard');
  playWin();
  showScreen('gameover');
}

socket.on('game-over', ({ finalScores }) => {
  showGameOver(finalScores);
});

document.getElementById('btn-new-game').addEventListener('click', () => {
  socket.emit('reset-game');
});

socket.on('game-reset', () => {
  showScreen('lobby');
  document.getElementById('btn-start-game').disabled = false;
});
