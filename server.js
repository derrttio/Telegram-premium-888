const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Хранилище в памяти
let users = [];        // { username, isPremium }
let messages = [];     // { from, to, text, file, timestamp }
let groups = [];
let groupMembers = [];
let groupMessages = [];
let channels = [];
let channelSubs = [];
let channelPosts = [];
let comments = [];
let gifts = [];

// Премиум для opex
if (!users.find(u => u.username === 'opex')) {
  users.push({ username: 'opex', isPremium: true });
} else {
  const o = users.find(u => u.username === 'opex');
  if (o) o.isPremium = true;
}

const clients = new Map();

function broadcastUserList() {
  const list = Array.from(clients.keys());
  for (let [username, ws] of clients.entries()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'user_list', users: list }));
    }
  }
}

function sendGroupsList(ws, username) {
  const myGroups = groupMembers
    .filter(gm => gm.username === username)
    .map(gm => groups.find(g => g.id === gm.group_id))
    .filter(g => g);
  ws.send(JSON.stringify({ type: 'groups_list', groups: myGroups || [] }));
}

function sendChannelsList(ws, username) {
  const channelList = channels.map(ch => ({
    id: ch.id,
    name: ch.name,
    owner: ch.owner,
    subscribers: ch.subscribers,
    is_subscribed: channelSubs.some(cs => cs.channel_id === ch.id && cs.username === username) ? 1 : 0
  }));
  ws.send(JSON.stringify({ type: 'channels_list', channels: channelList }));
}

function sendGiftsList(ws, username) {
  const myGifts = gifts.filter(g => g.to === username).slice(-20);
  ws.send(JSON.stringify({ type: 'gifts_list', gifts: myGifts }));
}

// Упрощённый HTML (но рабочий)
const htmlPage = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
    <title>Telegram Premium</title>
    <style>
        body { margin: 0; padding: 0; font-family: system-ui; background: #0e1621; color: white; }
        #login { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; }
        #login input, #login button { padding: 10px; margin: 5px; border-radius: 20px; border: none; }
        #login button { background: #ffd700; color: black; font-weight: bold; }
        #app { display: flex; height: 100vh; }
        .sidebar { width: 250px; background: #17212b; border-right: 1px solid #2b2f3a; overflow-y: auto; }
        .sidebar-header { padding: 15px; border-bottom: 1px solid #2b2f3a; }
        .sidebar .item { padding: 10px; cursor: pointer; border-bottom: 1px solid #2b2f3a; }
        .sidebar .item:hover { background: #1e2a36; }
        .chat { flex: 1; display: flex; flex-direction: column; }
        .chat-header { padding: 15px; background: #17212b; border-bottom: 1px solid #2b2f3a; }
        .messages { flex: 1; overflow-y: auto; padding: 15px; display: flex; flex-direction: column; gap: 8px; }
        .message { max-width: 70%; padding: 8px 12px; border-radius: 18px; }
        .message.out { background: #2b5278; align-self: flex-end; }
        .message.in { background: #1e2a36; align-self: flex-start; }
        .input-area { display: flex; padding: 10px; background: #17212b; gap: 8px; }
        .input-area input { flex: 1; padding: 8px; border-radius: 20px; border: none; background: #1e202a; color: white; }
        .input-area button { background: #2b5278; border: none; border-radius: 20px; padding: 8px 16px; color: white; }
        .sticker-btn, .gift-btn { background: #2b5278; border: none; border-radius: 20px; padding: 8px; margin-left: 5px; }
        .sticker-panel, .gift-panel { position: fixed; bottom: 70px; left: 0; right: 0; background: #17212b; padding: 10px; display: flex; flex-wrap: wrap; gap: 8px; border-top: 1px solid #ffd700; }
        .sticker { font-size: 30px; cursor: pointer; padding: 5px; background: #1e202a; border-radius: 10px; }
        .placeholder { text-align: center; color: #888; padding: 20px; }
    </style>
</head>
<body>
<div id="login">
    <h2 style="color:#ffd700;">Telegram Premium</h2>
    <input type="text" id="username" placeholder="Ваше имя">
    <button id="loginBtn">Войти</button>
</div>
<div id="app" style="display:none;">
    <div class="sidebar">
        <div class="sidebar-header" id="userInfo"></div>
        <div id="usersList"></div>
        <div id="groupsList"></div>
        <div id="channelsList"></div>
        <button id="createGroupBtn" style="margin:10px; background:#2b5278; border:none; padding:8px; border-radius:20px; color:white;">+ Группа</button>
        <button id="createChannelBtn" style="margin:10px; background:#2b5278; border:none; padding:8px; border-radius:20px; color:white;">+ Канал</button>
    </div>
    <div class="chat">
        <div class="chat-header" id="chatHeader">Выберите чат</div>
        <div class="messages" id="messages"></div>
        <div class="input-area">
            <button id="stickerBtn" class="sticker-btn">😊</button>
            <button id="giftBtn" class="gift-btn">🎁</button>
            <input type="text" id="messageInput" placeholder="Сообщение...">
            <button id="sendBtn">➤</button>
            <input type="file" id="fileInput" style="display:none">
            <button id="attachBtn">📎</button>
        </div>
    </div>
</div>
<div id="stickerPanel" class="sticker-panel" style="display:none">
    <div class="sticker" data-sticker="😀">😀</div><div class="sticker" data-sticker="😂">😂</div><div class="sticker" data-sticker="❤️">❤️</div><div class="sticker" data-sticker="🔥">🔥</div><div class="sticker" data-sticker="✨">✨</div><div class="sticker" data-sticker="🎉">🎉</div><div class="sticker" data-sticker="🥳">🥳</div><div class="sticker" data-sticker="💎">💎</div><div class="sticker" data-sticker="⭐️">⭐️</div><div class="sticker" data-sticker="🏆">🏆</div>
</div>
<div id="giftPanel" class="gift-panel" style="display:none">
    <div class="sticker" data-gift="🎁 Подарок">🎁</div><div class="sticker" data-gift="🎈 Шарик">🎈</div><div class="sticker" data-gift="🎂 Торт">🎂</div><div class="sticker" data-gift="💐 Цветы">💐</div><div class="sticker" data-gift="🍫 Шоколад">🍫</div>
</div>
<script>
let ws, currentUser, currentChat = null;
let groups = [], channels = [], users = [];
let messagesCache = {};
let isPremium = false;

const loginDiv = document.getElementById('login');
const appDiv = document.getElementById('app');
const usernameInput = document.getElementById('username');
const loginBtn = document.getElementById('loginBtn');
const usersListDiv = document.getElementById('usersList');
const groupsListDiv = document.getElementById('groupsList');
const channelsListDiv = document.getElementById('channelsList');
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const chatHeader = document.getElementById('chatHeader');
const userInfo = document.getElementById('userInfo');
const createGroupBtn = document.getElementById('createGroupBtn');
const createChannelBtn = document.getElementById('createChannelBtn');
const fileInput = document.getElementById('fileInput');
const attachBtn = document.getElementById('attachBtn');
const stickerBtn = document.getElementById('stickerBtn');
const stickerPanel = document.getElementById('stickerPanel');
const giftBtn = document.getElementById('giftBtn');
const giftPanel = document.getElementById('giftPanel');

loginBtn.onclick = () => {
    let name = usernameInput.value.trim();
    if (name) {
        currentUser = name;
        connect();
    }
};

function connect() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(protocol + '://' + location.host);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', userId: currentUser }));
    ws.onmessage = e => handleMessage(JSON.parse(e.data));
    ws.onclose = () => setTimeout(connect, 3000);
}

function handleMessage(m) {
    if (m.type === 'auth_ok') {
        loginDiv.style.display = 'none';
        appDiv.style.display = 'flex';
        isPremium = m.isPremium;
        userInfo.innerHTML = '<strong>' + currentUser + '</strong> ' + (isPremium ? '<span style="color:#ffd700;">⭐ PREMIUM</span>' : '');
        loadData();
    } else if (m.type === 'user_list') {
        users = m.users.filter(u => u !== currentUser);
        renderUsers();
    } else if (m.type === 'groups_list') {
        groups = m.groups;
        renderGroups();
    } else if (m.type === 'channels_list') {
        channels = m.channels;
        renderChannels();
    } else if (m.type === 'new_private_message') {
        addMessageToCache('private', m.from, m);
        if (currentChat && currentChat.type === 'user' && currentChat.id === m.from) renderMessages();
    } else if (m.type === 'new_group_message') {
        addMessageToCache('group', m.groupId, m);
        if (currentChat && currentChat.type === 'group' && currentChat.id === m.groupId) renderMessages();
    } else if (m.type === 'channel_posts') {
        messagesCache['channel_' + m.channelId] = m.posts;
        if (currentChat && currentChat.type === 'channel' && currentChat.id === m.channelId) renderPosts();
    } else if (m.type === 'new_post') {
        let key = 'channel_' + m.channelId;
        if (!messagesCache[key]) messagesCache[key] = [];
        messagesCache[key].unshift(m);
        if (currentChat && currentChat.type === 'channel' && currentChat.id === m.channelId) renderPosts();
    } else if (m.type === 'comments_list') {
        displayComments(m.postId, m.comments);
    } else if (m.type === 'gifts_list') {
        let html = '<div style="padding:10px;"><b>Подарки</b></div>';
        m.gifts.forEach(g => html += '<div>🎁 от ' + escapeHtml(g.from_user) + ': ' + g.gift_type + '</div>');
        if (m.gifts.length === 0) html += '<div class="placeholder">Нет подарков</div>';
        document.getElementById('channelsList').innerHTML = html;
    }
}

function loadData() {
    ws.send(JSON.stringify({ type: 'get_users' }));
    ws.send(JSON.stringify({ type: 'get_groups' }));
    ws.send(JSON.stringify({ type: 'get_channels' }));
}

function renderUsers() {
    let html = '<div style="padding:10px;"><b>Контакты</b></div>';
    users.forEach(u => {
        html += '<div class="item" data-user="' + u + '">' + u + (u === 'opex' ? ' ⭐' : '') + '</div>';
    });
    usersListDiv.innerHTML = html;
    document.querySelectorAll('[data-user]').forEach(el => {
        el.onclick = () => openChat({ type: 'user', id: el.getAttribute('data-user'), name: el.getAttribute('data-user') });
    });
}

function renderGroups() {
    let html = '<div style="padding:10px;"><b>Группы</b></div>';
    groups.forEach(g => {
        html += '<div class="item" data-group="' + g.id + '">👥 ' + escapeHtml(g.name) + '</div>';
    });
    groupsListDiv.innerHTML = html;
    document.querySelectorAll('[data-group]').forEach(el => {
        el.onclick = () => openChat({ type: 'group', id: parseInt(el.getAttribute('data-group')), name: el.innerText.replace('👥 ','') });
    });
}

function renderChannels() {
    let html = '<div style="padding:10px;"><b>Каналы</b></div>';
    channels.forEach(ch => {
        let sub = ch.is_subscribed ? '✅' : '🔔';
        html += '<div class="item" data-channel="' + ch.id + '">📢 ' + escapeHtml(ch.name) + ' ' + sub + ' (👥 ' + ch.subscribers + ')</div>';
    });
    channelsListDiv.innerHTML = html;
    document.querySelectorAll('[data-channel]').forEach(el => {
        el.onclick = () => openChat({ type: 'channel', id: parseInt(el.getAttribute('data-channel')), name: el.innerText.split(' ')[1] });
    });
}

function openChat(chat) {
    currentChat = chat;
    chatHeader.innerText = chat.name;
    if (chat.type === 'channel') {
        ws.send(JSON.stringify({ type: 'get_channel_posts', channelId: chat.id }));
    } else {
        ws.send(JSON.stringify({ type: 'get_history', chatType: chat.type, chatId: chat.id }));
    }
}

function addMessageToCache(type, id, msg) {
    let key = type + '_' + id;
    if (!messagesCache[key]) messagesCache[key] = [];
    messagesCache[key].push(msg);
}

function renderMessages() {
    if (!currentChat) return;
    let key = currentChat.type + '_' + currentChat.id;
    let msgs = messagesCache[key] || [];
    messagesDiv.innerHTML = '';
    msgs.forEach(m => {
        let div = document.createElement('div');
        div.className = 'message ' + (m.from === currentUser ? 'out' : 'in');
        let content = escapeHtml(m.text || '');
        if (m.file) {
            if (m.file.startsWith('data:image')) content += '<img src="' + m.file + '" style="max-width:150px;">';
            else content += '<a href="' + m.file + '">Файл</a>';
        }
        div.innerHTML = content + '<div style="font-size:10px; color:#aaa;">' + new Date(m.timestamp).toLocaleTimeString() + '</div>';
        messagesDiv.appendChild(div);
    });
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function renderPosts() {
    if (!currentChat || currentChat.type !== 'channel') return;
    let posts = messagesCache['channel_' + currentChat.id] || [];
    messagesDiv.innerHTML = '';
    posts.forEach(p => {
        let postDiv = document.createElement('div');
        postDiv.style.background = '#17212b';
        postDiv.style.borderRadius = '20px';
        postDiv.style.padding = '12px';
        postDiv.style.marginBottom = '12px';
        postDiv.style.borderLeft = '3px solid #ffd700';
        postDiv.innerHTML = '<div style="color:#ffd966;">📢 ' + escapeHtml(p.author) + ' · ' + new Date(p.timestamp).toLocaleString() + '</div>' +
                            '<div>' + escapeHtml(p.text) + '</div>' +
                            (p.file ? (p.file.startsWith('data:image') ? '<img src="' + p.file + '" style="max-width:100%; margin-top:8px;">' : '<a href="' + p.file + '">Файл</a>') : '') +
                            '<button class="show-comments" data-post="' + p.id + '">💬 Комментарии</button>' +
                            '<div id="comments-' + p.id + '" style="display:none; margin-top:8px;"></div>' +
                            '<div><input id="comment-input-' + p.id + '" placeholder="Комментарий..." style="width:80%; padding:5px; border-radius:15px;"><button onclick="addComment(' + p.id + ')">➤</button></div>';
        messagesDiv.appendChild(postDiv);
    });
    document.querySelectorAll('.show-comments').forEach(btn => {
        btn.onclick = () => {
            let pid = btn.getAttribute('data-post');
            let cont = document.getElementById('comments-' + pid);
            if (cont.style.display === 'none') {
                ws.send(JSON.stringify({ type: 'get_comments', postId: pid }));
                cont.style.display = 'block';
            } else {
                cont.style.display = 'none';
            }
        };
    });
}

function displayComments(pid, comments) {
    let container = document.getElementById('comments-' + pid);
    if (!container) return;
    let html = '';
    comments.forEach(c => {
        html += '<div style="background:#1e2a36; border-radius:12px; padding:5px; margin-bottom:5px;"><strong>' + escapeHtml(c.author) + '</strong>: ' + escapeHtml(c.text) + ' <span style="font-size:10px;">' + new Date(c.timestamp).toLocaleTimeString() + '</span></div>';
    });
    container.innerHTML = html;
}

window.addComment = function(pid) {
    let input = document.getElementById('comment-input-' + pid);
    let text = input.value.trim();
    if (text) {
        ws.send(JSON.stringify({ type: 'add_comment', postId: pid, text }));
        input.value = '';
    }
};

sendBtn.onclick = () => {
    if (!currentChat) return;
    let text = messageInput.value.trim();
    let file = fileInput.files[0];
    if (!text && !file) return;
    if (file) {
        let reader = new FileReader();
        reader.onload = e => {
            ws.send(JSON.stringify({ type: currentChat.type + '_message', to: currentChat.id, text: text || '', file: e.target.result }));
            messageInput.value = '';
            fileInput.value = '';
        };
        reader.readAsDataURL(file);
    } else {
        ws.send(JSON.stringify({ type: currentChat.type + '_message', to: currentChat.id, text }));
        messageInput.value = '';
    }
};

attachBtn.onclick = () => fileInput.click();

stickerBtn.onclick = () => {
    stickerPanel.style.display = stickerPanel.style.display === 'none' ? 'flex' : 'none';
    giftPanel.style.display = 'none';
};
giftBtn.onclick = () => {
    giftPanel.style.display = giftPanel.style.display === 'none' ? 'flex' : 'none';
    stickerPanel.style.display = 'none';
};
document.querySelectorAll('.sticker').forEach(s => {
    s.onclick = () => {
        let sticker = s.getAttribute('data-sticker') || s.innerText;
        if (currentChat) ws.send(JSON.stringify({ type: currentChat.type + '_message', to: currentChat.id, text: sticker }));
        stickerPanel.style.display = 'none';
    };
});
document.querySelectorAll('[data-gift]').forEach(g => {
    g.onclick = () => {
        let gift = g.getAttribute('data-gift');
        if (currentChat && currentChat.type === 'user') {
            ws.send(JSON.stringify({ type: 'send_gift', to: currentChat.id, gift }));
            giftPanel.style.display = 'none';
            alert('Подарок отправлен!');
        }
    };
});

createGroupBtn.onclick = () => {
    let name = prompt('Название группы');
    if (name) ws.send(JSON.stringify({ type: 'create_group', name }));
};
createChannelBtn.onclick = () => {
    let name = prompt('Название канала');
    if (name) ws.send(JSON.stringify({ type: 'create_channel', name }));
};

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, m => m === '&' ? '&amp;' : m === '<' ? '&lt;' : '&gt;');
}
</script>
</body>
</html>`;

app.get('/', (req, res) => res.send(htmlPage));

// WebSocket обработка (оставляем ту же, что была)
wss.on('connection', (ws) => {
  let currentUser = null;
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'auth') {
        currentUser = msg.userId;
        let user = users.find(u => u.username === currentUser);
        if (!user) {
          user = { username: currentUser, isPremium: (currentUser === 'opex') };
          users.push(user);
        } else if (currentUser === 'opex' && !user.isPremium) {
          user.isPremium = true;
        }
        clients.set(currentUser, ws);
        ws.send(JSON.stringify({ type: 'auth_ok', isPremium: user.isPremium }));
        broadcastUserList();
        sendGroupsList(ws, currentUser);
        sendChannelsList(ws, currentUser);
        sendGiftsList(ws, currentUser);
        return;
      }
      if (msg.type === 'get_users') {
        ws.send(JSON.stringify({ type: 'user_list', users: Array.from(clients.keys()) }));
        return;
      }
      if (msg.type === 'get_groups') {
        sendGroupsList(ws, currentUser);
        return;
      }
      if (msg.type === 'get_channels') {
        sendChannelsList(ws, currentUser);
        return;
      }
      if (msg.type === 'private_message') {
        const { to, text, file } = msg;
        const timestamp = Date.now();
        const newMsg = { from: currentUser, to, text: text || '', file: file || null, timestamp };
        messages.push(newMsg);
        const targetWs = clients.get(to);
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(JSON.stringify({ type: 'new_private_message', from: currentUser, text, file, timestamp }));
        }
        ws.send(JSON.stringify({ type: 'delivered' }));
        return;
      }
      if (msg.type === 'group_message') {
        const { groupId, text, file } = msg;
        const timestamp = Date.n
