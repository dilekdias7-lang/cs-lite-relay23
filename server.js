// CS-lite multiplayer relay. Run: npm install && npm start
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const lobbies = new Map(); // id -> { id, name, host, map, players: Map<ws, {id, nick}> }
let nextId = 1;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('cs-lite relay ok');
});

const wss = new WebSocketServer({ server });

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function lobbyList() {
  return [...lobbies.values()].map(l => ({
    id: l.id, name: l.name, host: l.host, map: l.map, players: l.players.size,
  }));
}

function broadcastLobbies() {
  for (const ws of wss.clients) send(ws, { t: 'lobbies', list: lobbyList() });
}

function leave(ws) {
  if (!ws.lobby) return;
  const l = lobbies.get(ws.lobby);
  ws.lobby = null;
  if (!l) return;
  l.players.delete(ws);
  for (const p of l.players.keys()) send(p, { t: 'left', id: ws.pid });
  if (l.players.size === 0) lobbies.delete(l.id);
  broadcastLobbies();
}

wss.on('connection', ws => {
  ws.pid = Math.random().toString(36).slice(2, 10);
  ws.lobby = null;
  send(ws, { t: 'hello', id: ws.pid, lobbies: lobbyList() });

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }

    if (m.t === 'create') {
      leave(ws);
      const id = String(nextId++);
      const nick = String(m.nick || 'Player').slice(0, 14);
      const l = { id, name: String(m.name || 'Лобби').slice(0, 24), host: nick, map: m.map | 0, players: new Map() };
      l.players.set(ws, { id: ws.pid, nick });
      lobbies.set(id, l);
      ws.lobby = id;
      send(ws, { t: 'joined', lobby: id, id: ws.pid, peers: [...l.players.values()] });
      broadcastLobbies();
    } else if (m.t === 'join') {
      const l = lobbies.get(String(m.lobby));
      if (!l) return send(ws, { t: 'error', msg: 'Лобби не найдено' });
      leave(ws);
      const nick = String(m.nick || 'Player').slice(0, 14);
      l.players.set(ws, { id: ws.pid, nick });
      ws.lobby = l.id;
      send(ws, { t: 'joined', lobby: l.id, id: ws.pid, peers: [...l.players.values()] });
      for (const p of l.players.keys()) if (p !== ws) send(p, { t: 'peer', peer: { id: ws.pid, nick } });
      broadcastLobbies();
    } else if (m.t === 'leave') {
      leave(ws);
    } else if (m.t === 'list') {
      send(ws, { t: 'lobbies', list: lobbyList() });
    } else if (m.t === 'msg') {
      // Relay game messages (presence, hit, kill) to everyone else in the same lobby.
      const l = lobbies.get(ws.lobby);
      if (!l) return;
      for (const p of l.players.keys()) if (p !== ws) send(p, { t: 'msg', from: ws.pid, topic: m.topic, data: m.data });
    }
  });

  ws.on('close', () => leave(ws));
});

server.listen(PORT, () => console.log('relay on ' + PORT));
