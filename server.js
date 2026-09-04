const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const tmi = require('tmi.js');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

function generateRoomCode() {
  let code;
  do {
    code = String(Math.floor(1000 + Math.random() * 9000));
  } while (rooms.has(code));
  return code;
}

function extractNumber(message) {
  let text = message.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  text = text.replace(/,/g, '');
  text = text.replace(/(ريال|دولار|درهم|دينار|ر\.س|SAR|\$|⃁)/gi, '');
  const match = text.match(/(\d+\.?\d*)/);
  if (!match) return null;
  const num = parseFloat(match[1]);
  if (num <= 0) return null;
  return num;
}

function rankGuesses(guesses, actualPrice) {
  const entries = Array.from(guesses.entries()).map(([name, data]) => ({
    name,
    value: data.value,
    type: data.type,
    timestamp: data.timestamp
  }));

  const under = entries.filter(g => g.value <= actualPrice);
  const over = entries.filter(g => g.value > actualPrice);

  under.sort((a, b) => {
    if (b.value !== a.value) return b.value - a.value;
    return a.timestamp - b.timestamp;
  });

  over.sort((a, b) => {
    if (a.value !== b.value) return a.value - b.value;
    return a.timestamp - b.timestamp;
  });

  if (under.length === 0) return over;
  return [...under, ...over];
}

function getRoomState(room) {
  return {
    roomCode: room.roomCode,
    players: Array.from(room.players.entries()).map(([name, p]) => ({
      name,
      type: p.type,
      score: p.score
    })),
    settings: room.settings,
    state: room.state,
    currentRound: room.currentRound ? {
      number: room.currentRound.number,
      productName: room.currentRound.productName,
      currency: room.settings.currency
    } : null
  };
}

io.on('connection', (socket) => {

  socket.on('create-room', () => {
    const roomCode = generateRoomCode();
    const room = {
      roomCode,
      hostSocket: socket.id,
      players: new Map(),
      settings: {
        totalRounds: 10,
        roundDuration: 20,
        currency: '⃁'
      },
      state: 'lobby',
      currentRound: null,
      twitchClient: null,
      twitchChannel: null
    };
    rooms.set(roomCode, room);
    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.isHost = true;
    socket.emit('room-created', { roomCode });
  });

  socket.on('update-settings', (data) => {
    const room = rooms.get(socket.roomCode);
    if (!room || socket.id !== room.hostSocket) return;
    if (data.totalRounds) room.settings.totalRounds = parseInt(data.totalRounds);
    if (data.roundDuration) room.settings.roundDuration = parseInt(data.roundDuration);
    if (data.currency !== undefined) room.settings.currency = data.currency;
  });

  socket.on('watch-room', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit('join-error', { message: 'الغرفة غير موجودة' });
      return;
    }
    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.isOverlay = true;

    const playerList = Array.from(room.players.entries()).map(([name, p]) => ({
      name, type: p.type, score: p.score
    }));

    socket.emit('watch-success', {
      roomCode,
      state: room.state,
      settings: room.settings,
      players: playerList,
      currentRound: room.currentRound ? {
        number: room.currentRound.number,
        productName: room.currentRound.productName,
        currency: room.settings.currency,
        totalRounds: room.settings.totalRounds,
        guessCount: room.currentRound.guesses.size
      } : null
    });
  });

  socket.on('join-room', ({ roomCode, playerName }) => {
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit('join-error', { message: 'الغرفة غير موجودة' });
      return;
    }
    const existing = room.players.get(playerName);
    if (existing) {
      // Allow reclaiming a name whose previous connection is gone (mobile
      // networks drop often) — keep the accumulated score. Reject only if a
      // live socket is still using that name.
      const isTaken = existing.type === 'twitch' ||
        (existing.socketId && io.sockets.sockets.has(existing.socketId));
      if (isTaken) {
        socket.emit('join-error', { message: 'الاسم مستخدم، اختر اسم ثاني' });
        return;
      }
      existing.socketId = socket.id;
      existing.type = 'web';
    } else {
      room.players.set(playerName, {
        type: 'web',
        socketId: socket.id,
        score: 0
      });
    }
    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.playerName = playerName;

    const playerList = Array.from(room.players.entries()).map(([name, p]) => ({
      name, type: p.type, score: p.score
    }));

    io.to(roomCode).emit('player-joined', {
      name: playerName,
      type: 'web',
      playerCount: room.players.size,
      players: playerList
    });

    socket.emit('join-success', {
      roomCode,
      playerName,
      state: room.state,
      settings: room.settings,
      alreadyGuessed: !!(room.state === 'active' && room.currentRound &&
        room.currentRound.guesses && room.currentRound.guesses.has(playerName)),
      currentRound: room.currentRound ? {
        number: room.currentRound.number,
        productName: room.currentRound.productName,
        currency: room.settings.currency,
        totalRounds: room.settings.totalRounds
      } : null
    });
  });

  socket.on('start-game', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || socket.id !== room.hostSocket) return;
    room.state = 'setup';
    room.currentRound = { number: 0 };
    io.to(room.roomCode).emit('game-started', {
      totalRounds: room.settings.totalRounds
    });
  });

  socket.on('start-round', ({ productName, actualPrice }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || socket.id !== room.hostSocket) return;

    const price = parseFloat(actualPrice);
    const name = String(productName || '').trim();
    if (!name || !isFinite(price) || price <= 0) {
      socket.emit('round-error', { message: 'أدخل اسم المنتج وسعر صحيح' });
      return;
    }

    const roundNumber = (room.currentRound ? room.currentRound.number : 0) + 1;
    room.currentRound = {
      number: roundNumber,
      productName: name,
      actualPrice: price,
      guesses: new Map(),
      startTime: Date.now()
    };
    room.state = 'active';

    io.to(room.roomCode).emit('round-started', {
      roundNumber,
      totalRounds: room.settings.totalRounds,
      productName,
      currency: room.settings.currency,
      duration: room.settings.roundDuration
    });

    let remaining = room.settings.roundDuration;
    room.currentRound.timer = setInterval(() => {
      remaining--;
      io.to(room.roomCode).emit('timer-tick', { remaining });
      if (remaining <= 0) {
        clearInterval(room.currentRound.timer);
        endRound(room);
      }
    }, 1000);
  });

  socket.on('end-round-early', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || socket.id !== room.hostSocket) return;
    if (room.state !== 'active') return;
    if (room.currentRound && room.currentRound.timer) {
      clearInterval(room.currentRound.timer);
    }
    endRound(room);
  });

  socket.on('submit-guess', ({ guess }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.state !== 'active') return;
    if (!socket.playerName) return;
    if (room.currentRound.guesses.has(socket.playerName)) {
      socket.emit('guess-error', { message: 'سبق وأرسلت تخمينك' });
      return;
    }

    const value = extractNumber(String(guess));
    if (value === null) {
      socket.emit('guess-error', { message: 'أدخل رقم صحيح' });
      return;
    }

    room.currentRound.guesses.set(socket.playerName, {
      value,
      type: 'web',
      timestamp: Date.now()
    });

    socket.emit('guess-confirmed', { value });
    io.to(room.roomCode).emit('guess-count-updated', {
      guessed: room.currentRound.guesses.size,
      total: room.players.size
    });
  });

  socket.on('next-round', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || socket.id !== room.hostSocket) return;
    room.state = 'setup';
    io.to(room.roomCode).emit('next-round-ready', {
      roundNumber: room.currentRound.number + 1,
      totalRounds: room.settings.totalRounds
    });
  });

  socket.on('reset-game', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || socket.id !== room.hostSocket) return;
    room.players.forEach((p) => { p.score = 0; });
    room.state = 'lobby';
    room.currentRound = null;
    io.to(room.roomCode).emit('game-reset');
  });

  socket.on('connect-twitch', ({ channel }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || socket.id !== room.hostSocket) return;

    if (room.twitchClient) {
      room.twitchClient.disconnect().catch(() => {});
    }

    const client = new tmi.Client({
      channels: [channel]
    });

    client.connect().then(() => {
      room.twitchClient = client;
      room.twitchChannel = channel;
      socket.emit('twitch-connected', { channel });

      client.on('message', (ch, tags, message, self) => {
        if (self) return;
        const username = tags['display-name'] || tags.username;

        const lower = message.trim().toLowerCase();
        if (lower === '!join' || lower === '!انضم') {
          if (!room.players.has(username)) {
            room.players.set(username, {
              type: 'twitch',
              socketId: null,
              score: 0
            });
            const playerList = Array.from(room.players.entries()).map(([name, p]) => ({
              name, type: p.type, score: p.score
            }));
            io.to(room.roomCode).emit('player-joined', {
              name: username,
              type: 'twitch',
              playerCount: room.players.size,
              players: playerList
            });
          }
          return;
        }

        if (lower === '!leave' || lower === '!انسحب') {
          if (room.players.has(username)) {
            room.players.delete(username);
            io.to(room.roomCode).emit('player-left', {
              name: username,
              playerCount: room.players.size
            });
          }
          return;
        }

        if (room.state === 'active' && room.players.has(username)) {
          if (room.currentRound.guesses.has(username)) return;
          const value = extractNumber(message);
          if (value === null) return;

          room.currentRound.guesses.set(username, {
            value,
            type: 'twitch',
            timestamp: Date.now()
          });

          io.to(room.roomCode).emit('guess-count-updated', {
            guessed: room.currentRound.guesses.size,
            total: room.players.size
          });
        }
      });
    }).catch((err) => {
      socket.emit('twitch-error', { message: 'فشل الاتصال بتويتش: ' + err.message });
    });
  });

  socket.on('disconnect-twitch', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || socket.id !== room.hostSocket) return;
    if (room.twitchClient) {
      room.twitchClient.disconnect().catch(() => {});
      room.twitchClient = null;
      room.twitchChannel = null;
      socket.emit('twitch-disconnected');
    }
  });

  socket.on('disconnect', () => {
    if (socket.isHost && socket.roomCode) {
      const room = rooms.get(socket.roomCode);
      if (room) {
        if (room.currentRound && room.currentRound.timer) {
          clearInterval(room.currentRound.timer);
        }
        if (room.twitchClient) {
          room.twitchClient.disconnect().catch(() => {});
        }
        io.to(room.roomCode).emit('host-disconnected');
        rooms.delete(socket.roomCode);
      }
    } else if (socket.playerName && socket.roomCode) {
      const room = rooms.get(socket.roomCode);
      if (room && room.players.has(socket.playerName)) {
        const player = room.players.get(socket.playerName);
        if (player.type === 'web') {
          if (room.state === 'lobby') {
            // No score to protect yet — free the name for others.
            room.players.delete(socket.playerName);
            io.to(room.roomCode).emit('player-left', {
              name: socket.playerName,
              playerCount: room.players.size
            });
          } else {
            // Mid-game: keep the record (and score) so the player can
            // reconnect with the same name and pick up where they left off.
            player.socketId = null;
          }
        }
      }
    }
  });
});

const PERFECT_BONUS = 2;

function endRound(room) {
  room.state = 'results';
  const actualPrice = room.currentRound.actualPrice;
  const ranked = rankGuesses(room.currentRound.guesses, actualPrice);

  const points = [3, 2, 1];
  ranked.forEach((entry, index) => {
    const base = index < 3 ? points[index] : 0;
    const perfect = entry.value === actualPrice;
    entry.awarded = base + (perfect ? PERFECT_BONUS : 0);
    entry.perfect = perfect;
    if (entry.awarded > 0) {
      const player = room.players.get(entry.name);
      if (player) {
        player.score += entry.awarded;
      }
    }
  });

  const playersWhoDidntGuess = [];
  room.players.forEach((p, name) => {
    if (!room.currentRound.guesses.has(name)) {
      playersWhoDidntGuess.push({ name, type: p.type });
    }
  });

  const rankings = ranked.map((entry, index) => {
    const diff = Math.abs(entry.value - actualPrice);
    const isOver = entry.value > actualPrice;
    return {
      rank: index + 1,
      name: entry.name,
      type: entry.type,
      guess: entry.value,
      difference: diff,
      isOver,
      perfect: entry.perfect,
      points: entry.awarded
    };
  });

  const scores = Array.from(room.players.entries())
    .map(([name, p]) => ({ name, score: p.score, type: p.type }))
    .sort((a, b) => b.score - a.score);

  const isLastRound = room.currentRound.number >= room.settings.totalRounds;

  const resultData = {
    roundNumber: room.currentRound.number,
    totalRounds: room.settings.totalRounds,
    productName: room.currentRound.productName,
    actualPrice,
    currency: room.settings.currency,
    rankings,
    didntGuess: playersWhoDidntGuess,
    scores,
    isLastRound
  };

  io.to(room.roomCode).emit('round-result', resultData);

  room.players.forEach((player, name) => {
    if (player.type === 'web' && player.socketId) {
      const guess = room.currentRound.guesses.get(name);
      const rankEntry = rankings.find(r => r.name === name);
      io.to(player.socketId).emit('your-result', {
        yourGuess: guess ? guess.value : null,
        rank: rankEntry ? rankEntry.rank : null,
        difference: rankEntry ? rankEntry.difference : null,
        isOver: rankEntry ? rankEntry.isOver : null,
        perfect: rankEntry ? rankEntry.perfect : false,
        points: rankEntry ? rankEntry.points : 0,
        totalScore: player.score,
        didGuess: !!guess
      });
    }
  });

  if (isLastRound) {
    room.state = 'gameover';
    io.to(room.roomCode).emit('game-over', { finalScores: scores });
  }
}

app.get('/join/:roomCode', (req, res) => {
  res.redirect(`/play.html?room=${req.params.roomCode}`);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
