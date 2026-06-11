const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Хранилище пользователей и сообщений
const users = new Map(); // username -> ws
const messages = [];

// Премиум для opex
const premiumUsers = new Set(['opex']);

wss.on('connection', (ws) => {
  let username = null;

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    
    if (msg.type === 'auth') {
      username = msg.username;
      users.set(username, ws);
      ws.send(JSON.stringify({ type: 'auth_ok', isPremium: premiumUsers.has(username) }));
      // Отправить список пользователей
      broadcastUserList();
      // Отправить историю сообщений
      ws.send(JSON.stringify({ type: 'history', messages: messages.slice(-50) }));
      return;
    }
    
    if (msg.type === 'message') {
      const { to, text } = msg;
      const newMsg = { from: username, to, text, timestamp: Date.now() };
      messages.push(newMsg);
      // Отправить получателю, если он онлайн
      const recipientWs = users.get(to);
      if (recipientWs) {
        recipientWs.send(JSON.stringify({ type: 'message', ...newMsg }));
      }
      // Подтверждение отправителю
      ws.send(JSON.stringify({ type: 'delivered', to }));
    }
  });

  ws.on('close', () => {
    if (username) {
      users.delete(username);
      broadcastUserList();
    }
  });
});

function broadcastUserList() {
  const userList = Array.from(users.keys());
  for (let [_, ws] of users.entries()) {
    ws.send(JSON.stringify({ type: 'user_list', users: userList }));
  }
}

// Простой HTML интерфейс
const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Telegram Premium</title>
  <style>
    body { margin: 0; font-family: system-ui; background: #0e1621; color: white; }
    #login { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; }
    #login input, #login button { padding: 10px; margin: 5px; border-radius: 20px; border: none; }
    #login button { background: #ffd700; color: black; font-weight: bold; }
    #app { display: flex; height: 100vh; }
    .sidebar { width: 250px; background: #17212b; border-right: 1px solid #2b2f3a; overflow-y: auto; }
    .sidebar div { padding: 12px; cursor: pointer; border-bottom: 1px solid #2b2f3a; }
    .sidebar div:hover { background: #1e2a36; }
    .chat { flex: 1; display: flex; flex-direction: column; }
    .chat-header { padding: 15px; background: #17212b; border-bottom: 1px solid #2b2f3a; }
    .messages { flex: 1; overflow-y: auto; padding: 15px; display: flex; flex-direction: column; gap: 8px; }
    .message { max-width: 70%; padding: 8px 12px; border-radius: 18px; }
    .message.out { background: #2b5278; align-self: flex-end; }
    .message.in { background: #1e2a36; align-self: flex-start; }
    .input-area { display: flex; padding: 10px; background: #17212b; gap: 8px; }
    .input-area input { flex: 1; padding: 8px; border-radius: 20px; border: none; background: #1e202a; color: white; }
    .input-area button { background: #2b5278; border: none; border-radius: 20px; padding: 8px 16px; color: white; }
    .premium { color: #ffd700; font-weight: bold; }
  </style>
</head>
<body>
<div id="login">
  <h2 style="color:#ffd700;">Telegram Premium</h2>
  <input type="text" id="username" placeholder="Ваше имя">
  <button id="loginBtn">Войти</button>
</div>
<div id="app" style="display:none;">
  <div class="sidebar" id="sidebar"></div>
  <div class="chat">
    <div class="chat-header" id="chatHeader">Выберите чат</div>
    <div class="messages" id="messages"></div>
    <div class="input-area">
      <input type="text" id="messageInput" placeholder="Сообщение...">
      <button id="sendBtn">➤</button>
    </div>
  </div>
</div>
<script>
  let ws, currentUser, currentChat = null;
  let messagesCache = [];
  let users = [];

  const loginDiv = document.getElementById('login');
  const appDiv = document.getElementById('app');
  const usernameInput = document.getElementById('username');
  const loginBtn = document.getElementById('loginBtn');
  const sidebar = document.getElementById('sidebar');
  const messagesDiv = document.getElementById('messages');
  const messageInput = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');
  const chatHeader = document.getElementById('chatHeader');

  loginBtn.onclick = () => {
    const name = usernameInput.value.trim();
    if (name) {
      currentUser = name;
      connect();
    }
  };

  function connect() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(protocol + '://' + location.host);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', username: currentUser }));
    ws.onmessage = (e) => handleMessage(JSON.parse(e.data));
    ws.onclose = () => setTimeout(connect, 3000);
  }

  function handleMessage(msg) {
    if (msg.type === 'auth_ok') {
      loginDiv.style.display = 'none';
      appDiv.style.display = 'flex';
      document.title = currentUser + (msg.isPremium ? ' ⭐' : '');
      if (msg.isPremium) chatHeader.innerHTML += ' <span class="premium">PREMIUM</span>';
    } else if (msg.type === 'user_list') {
      users = msg.users.filter(u => u !== currentUser);
      renderUsers();
    } else if (msg.type === 'history') {
      messagesCache = msg.messages;
      if (currentChat) renderMessages();
    } else if (msg.type === 'message') {
      if (msg.from === currentChat || msg.to === currentChat) {
        messagesCache.push(msg);
        renderMessages();
      }
    }
  }

  function renderUsers() {
    let html = '<div style="padding:10px;"><b>Контакты</b></div>';
    users.forEach(u => {
      html += '<div data-user="' + u + '">' + u + (u === 'opex' ? ' ⭐' : '') + '</div>';
    });
    sidebar.innerHTML = html;
    document.querySelectorAll('[data-user]').forEach(el => {
      el.onclick = () => {
        currentChat = el.getAttribute('data-user');
        chatHeader.innerText = currentChat;
        renderMessages();
      };
    });
  }

  function renderMessages() {
    messagesDiv.innerHTML = '';
    const chatMessages = messagesCache.filter(m => (m.from === currentChat && m.to === currentUser) || (m.from === currentUser && m.to === currentChat));
    chatMessages.forEach(m => {
      const div = document.createElement('div');
      div.className = 'message ' + (m.from === currentUser ? 'out' : 'in');
      div.innerHTML = m.text + '<div style="font-size:10px;color:#aaa;">' + new Date(m.timestamp).toLocaleTimeString() + '</div>';
      messagesDiv.appendChild(div);
    });
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  sendBtn.onclick = () => {
    const text = messageInput.value.trim();
    if (text && currentChat) {
      ws.send(JSON.stringify({ type: 'message', to: currentChat, text }));
      messageInput.value = '';
    }
  };
</script>
</body>
</html>
`;

app.get('/', (req, res) => res.send(html));

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
