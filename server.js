const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Хранилище (в памяти)
let messages = [];     // { from, to, text, timestamp }
const clients = new Map(); // userId -> ws

// HTML + CSS + JS (мобильный премиум-дизайн)
const htmlPage = `
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>Premium Messenger</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      -webkit-tap-highlight-color: transparent;
    }
    body {
      background: #0a0c10;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, sans-serif;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    /* Золотые акценты */
    .premium-gold {
      background: linear-gradient(135deg, #e6b800 0%, #ffd700 100%);
      color: #1e1e2a;
    }
    .premium-text {
      color: #ffd966;
    }
    .premium-border {
      border-color: #ffd700;
    }
    /* Шапка */
    .header {
      background: rgba(18, 20, 28, 0.95);
      backdrop-filter: blur(10px);
      padding: 12px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      border-bottom: 1px solid #2a2e3a;
    }
    .logo {
      font-size: 24px;
      font-weight: bold;
      background: linear-gradient(135deg, #e6b800, #ffd700);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }
    .premium-badge {
      background: #ffd700;
      color: #1e1e2a;
      font-size: 12px;
      font-weight: bold;
      padding: 2px 8px;
      border-radius: 20px;
      margin-left: 8px;
    }
    /* Панель логина */
    .login-panel {
      padding: 16px;
      background: #12141c;
      display: flex;
      gap: 10px;
      border-bottom: 1px solid #2a2e3a;
    }
    .login-panel input {
      flex: 1;
      background: #1e202a;
      border: 1px solid #2a2e3a;
      border-radius: 24px;
      padding: 12px 18px;
      color: white;
      font-size: 16px;
      outline: none;
      transition: 0.2s;
    }
    .login-panel input:focus {
      border-color: #ffd700;
      box-shadow: 0 0 0 2px rgba(255, 215, 0, 0.2);
    }
    .login-panel button {
      background: linear-gradient(135deg, #e6b800, #ffd700);
      border: none;
      border-radius: 28px;
      padding: 0 24px;
      font-weight: bold;
      color: #121212;
      font-size: 16px;
      cursor: pointer;
      transition: transform 0.1s;
    }
    .login-panel button:active {
      transform: scale(0.96);
    }
    /* Список пользователей */
    .users-section {
      background: #12141c;
      max-height: 30%;
      overflow-y: auto;
      border-bottom: 1px solid #2a2e3a;
      padding: 8px 0;
    }
    .section-title {
      padding: 8px 16px;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #ffd966;
    }
    .user-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      cursor: pointer;
      transition: background 0.1s;
    }
    .user-item:active {
      background: #1e202a;
    }
    .avatar {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: #2a2e3a;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 18px;
      color: white;
      flex-shrink: 0;
    }
    .user-info {
      flex: 1;
    }
    .user-name {
      font-weight: 600;
      color: white;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .premium-icon {
      font-size: 14px;
      filter: drop-shadow(0 0 2px gold);
    }
    /* Чат */
    .chat-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: #0a0c10;
      overflow: hidden;
    }
    .chat-header {
      padding: 12px 16px;
      background: rgba(18, 20, 28, 0.9);
      backdrop-filter: blur(8px);
      border-bottom: 1px solid #2a2e3a;
      color: white;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      background: url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgdmlld0JveD0iMCAwIDQwIDQwIj48Y2lyY2xlIGN4PSIyMCIgY3k9IjIwIiByPSIxIiBmaWxsPSIjMjkyYzM1IiBmaWxsLW9wYWNpdHk9IjAuMiIvPjwvc3ZnPg==');
      background-repeat: repeat;
    }
    .message {
      max-width: 85%;
      padding: 10px 14px;
      border-radius: 20px;
      font-size: 15px;
      word-wrap: break-word;
      position: relative;
      animation: fadeIn 0.2s ease;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .message.out {
      background: linear-gradient(135deg, #2a6c4e, #1f5a41);
      color: white;
      align-self: flex-end;
      border-bottom-right-radius: 4px;
    }
    .message.in {
      background: #1e202a;
      color: white;
      align-self: flex-start;
      border-bottom-left-radius: 4px;
    }
    .premium-message {
      border-left: 3px solid #ffd700;
    }
    .time {
      font-size: 10px;
      color: #aaa;
      margin-top: 4px;
      text-align: right;
    }
    /* Поле ввода */
    .input-area {
      display: flex;
      gap: 10px;
      padding: 12px 16px;
      background: #12141c;
      border-top: 1px solid #2a2e3a;
    }
    .input-area input {
      flex: 1;
      background: #1e202a;
      border: 1px solid #2a2e3a;
      border-radius: 28px;
      padding: 12px 18px;
      color: white;
      font-size: 16px;
      outline: none;
    }
    .input-area input:focus {
      border-color: #ffd700;
    }
    .input-area button {
      background: linear-gradient(135deg, #e6b800, #ffd700);
      border: none;
      border-radius: 32px;
      width: 48px;
      font-weight: bold;
      font-size: 20px;
      cursor: pointer;
      transition: 0.1s;
    }
    .input-area button:active {
      transform: scale(0.92);
    }
    .placeholder {
      text-align: center;
      color: #6c7883;
      padding: 40px 20px;
    }
    button:disabled, input:disabled {
      opacity: 0.6;
    }
    /* Премиум эффект пульсации */
    @keyframes glow {
      0% { box-shadow: 0 0 0 0 rgba(255, 215, 0, 0.3); }
      70% { box-shadow: 0 0 0 6px rgba(255, 215, 0, 0); }
      100% { box-shadow: 0 0 0 0 rgba(255, 215, 0, 0); }
    }
    .premium-glow:focus, .premium-glow:active {
      animation: glow 0.4s;
    }
  </style>
</head>
<body>
<div class="header">
  <span class="logo">✧ Premium Messenger ✧</span>
  <span class="premium-badge">PREMIUM</span>
</div>
<div class="login-panel">
  <input type="text" id="username" placeholder="Ваше имя" autocomplete="off">
  <button id="loginBtn">Войти</button>
</div>
<div class="users-section" id="usersList">
  <div class="section-title">КОНТАКТЫ</div>
  <div class="placeholder">Авторизуйтесь</div>
</div>
<div class="chat-area">
  <div class="chat-header" id="chatHeader">
    <span>✨ Выберите диалог</span>
  </div>
  <div class="messages" id="messages">
    <div class="placeholder">✨ Премиум-мессенджер готов ✨</div>
  </div>
  <div class="input-area">
    <input type="text" id="messageInput" placeholder="Сообщение..." disabled>
    <button id="sendBtn" disabled>➤</button>
  </div>
</div>
<script>
  let ws, currentUser, selectedUser;
  let messagesCache = {};
  const loginBtn = document.getElementById('loginBtn');
  const usernameInput = document.getElementById('username');
  const usersListDiv = document.getElementById('usersList');
  const messagesDiv = document.getElementById('messages');
  const messageInput = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');
  const chatHeader = document.getElementById('chatHeader');

  loginBtn.onclick = () => {
    let name = usernameInput.value.trim();
    if (!name) return alert('Введите имя');
    currentUser = name;
    connectWebSocket();
  };

  function connectWebSocket() {
    ws = new WebSocket(\`ws://\${window.location.host}\`);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', userId: currentUser }));
    ws.onmessage = (e) => handleMessage(JSON.parse(e.data));
    ws.onclose = () => setTimeout(connectWebSocket, 2000);
  }

  function handleMessage(msg) {
    if (msg.type === 'auth_ok') {
      loginBtn.disabled = true;
      usernameInput.disabled = true;
      chatHeader.innerHTML = \`👤 \${currentUser} <span class="premium-icon">⭐️ Premium</span>\`;
    } else if (msg.type === 'history') {
      messagesCache = {};
      msg.messages.forEach(m => {
        let partner = m.from === currentUser ? m.to : m.from;
        if (!messagesCache[partner]) messagesCache[partner] = [];
        messagesCache[partner].push(m);
      });
      if (selectedUser) renderMessages();
    } else if (msg.type === 'message') {
      let partner = msg.from === currentUser ? selectedUser : msg.from;
      if (msg.from === currentUser && selectedUser) {
        if (!messagesCache[selectedUser]) messagesCache[selectedUser] = [];
        messagesCache[selectedUser].push(msg);
        renderMessages();
      } else if (msg.from !== currentUser) {
        if (!messagesCache[msg.from]) messagesCache[msg.from] = [];
        messagesCache[msg.from].push(msg);
        if (selectedUser === msg.from) renderMessages();
      }
      updateUsersList();
    } else if (msg.type === 'user_list') {
      renderUsersList(msg.users);
    }
  }

  function renderUsersList(users) {
    const contactsDiv = document.querySelector('.users-section');
    let html = '<div class="section-title">КОНТАКТЫ</div>';
    let otherUsers = users.filter(u => u !== currentUser);
    if (otherUsers.length === 0) html += '<div class="placeholder">✨ Никого нет, пригласите друга ✨</div>';
    otherUsers.forEach(user => {
      let avatarColor = getAvatarColor(user);
      html += \`
        <div class="user-item" data-user="\${user}">
          <div class="avatar" style="background: \${avatarColor}">\${user.charAt(0).toUpperCase()}</div>
          <div class="user-info">
            <div class="user-name">\${user} <span class="premium-icon">⭐️</span></div>
          </div>
        </div>
      \`;
    });
    usersListDiv.innerHTML = html;
    document.querySelectorAll('.user-item').forEach(el => {
      el.onclick = () => {
        selectedUser = el.getAttribute('data-user');
        chatHeader.innerHTML = \`💎 \${selectedUser} <span class="premium-icon">⭐️ Premium</span>\`;
        messageInput.disabled = false;
        sendBtn.disabled = false;
        renderMessages();
        // подсветка выбранного
        document.querySelectorAll('.user-item').forEach(i => i.style.background = '');
        el.style.background = '#2a2e3a';
      };
    });
  }

  function getAvatarColor(userId) {
    const colors = ['#e6b800', '#ffd966', '#f9a825', '#ffb300', '#d4af37'];
    let hash = 0;
    for (let i = 0; i < userId.length; i++) hash += userId.charCodeAt(i);
    return colors[hash % colors.length];
  }

  function renderMessages() {
    if (!selectedUser) return;
    messagesDiv.innerHTML = '';
    const msgs = messagesCache[selectedUser] || [];
    msgs.forEach(m => {
      const isOut = m.from === currentUser;
      const msgDiv = document.createElement('div');
      msgDiv.className = \`message \${isOut ? 'out' : 'in'}\`;
      if (!isOut) msgDiv.classList.add('premium-message');
      msgDiv.innerHTML = \`
        <div>\${escapeHtml(m.text)}</div>
        <div class="time">\${new Date(m.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
      \`;
      messagesDiv.appendChild(msgDiv);
    });
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  function escapeHtml(str) {
    return str.replace(/[&<>]/g, function(m) {
      if (m === '&') return '&amp;';
      if (m === '<') return '&lt;';
      if (m === '>') return '&gt;';
      return m;
    });
  }

  sendBtn.onclick = () => {
    let text = messageInput.value.trim();
    if (!text || !selectedUser || !ws) return;
    ws.send(JSON.stringify({ type: 'message', to: selectedUser, text }));
    messageInput.value = '';
  };
  messageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendBtn.click(); });

  function updateUsersList() {
    if (ws && ws.readyState === WebSocket.OPEN && currentUser) {
      ws.send(JSON.stringify({ type: 'get_users' }));
    }
  }
  setInterval(updateUsersList, 3000);
</script>
</body>
</html>
`;

// HTTP сервер отдаёт эту страницу
app.get('/', (req, res) => res.send(htmlPage));

// WebSocket логика
wss.on('connection', (ws) => {
  let currentUser = null;
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'auth') {
        currentUser = msg.userId;
        clients.set(currentUser, ws);
        ws.send(JSON.stringify({ type: 'auth_ok', userId: currentUser }));
        const userMessages = messages.filter(m => m.from === currentUser || m.to === currentUser).slice(-50);
        ws.send(JSON.stringify({ type: 'history', messages: userMessages }));
        broadcastUserList();
        return;
      }
      if (msg.type === 'message') {
        const { to, text } = msg;
        const timestamp = Date.now();
        const newMsg = { from: currentUser, to, text, timestamp };
        messages.push(newMsg);
        const targetWs = clients.get(to);
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(JSON.stringify({ type: 'message', from: currentUser, text, timestamp }));
        }
        ws.send(JSON.stringify({ type: 'delivered', to, text }));
        return;
      }
      if (msg.type === 'get_users') {
        const userList = Array.from(clients.keys()).filter(u => u);
        ws.send(JSON.stringify({ type: 'user_list', users: userList }));
        return;
      }
    } catch(e) { console.error(e); }
  });
  ws.on('close', () => {
    if (currentUser) clients.delete(currentUser);
    broadcastUserList();
  });
});

function broadcastUserList() {
  const userList = Array.from(clients.keys()).filter(u => u);
  for (let [userId, clientWs] of clients.entries()) {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ type: 'user_list', users: userList }));
    }
  }
}

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Premium server on port ${PORT}`));
