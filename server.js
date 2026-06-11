const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Хранилища в памяти
const users = new Map(); // username -> { ws, isPremium }
const messages = []; // { from, to, text, file, timestamp }
const groups = new Map(); // groupId -> { name, members, messages }
const channels = new Map(); // channelId -> { name, owner, subscribers, posts }
let nextGroupId = 1, nextChannelId = 1;

// Создаём пользователя opex как премиум
users.set('opex', { isPremium: true });

// HTML интерфейс (такой же, как был, но с небольшими изменениями)
const htmlPage = `
... (здесь должен быть HTML) ...
`;

app.get('/', (req, res) => res.send(htmlPage));

// WebSocket обработка (без SQLite)
const clients = new Map(); // username -> ws
const groupMembers = new Map(); // groupId -> Set of usernames
const groupMessages = new Map(); // groupId -> array of messages
const channelSubs = new Map(); // channelId -> Set of usernames
const channelPosts = new Map(); // channelId -> array of posts
const comments = new Map(); // postId -> array of comments
const gifts = []; // {from, to, gift, timestamp}

wss.on('connection', (ws) => {
  let currentUser = null;

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

      if (msg.type === 'auth') {
        currentUser = msg.userId;
        if (!users.has(currentUser)) {
          users.set(currentUser, { isPremium: currentUser === 'opex' });
        }
        clients.set(currentUser, ws);
        ws.send(JSON.stringify({
          type: 'auth_ok',
          isPremium: users.get(currentUser).isPremium
        }));
        // Отправить списки
        broadcastUserList();
        sendGroups(ws, currentUser);
        sendChannels(ws, currentUser);
        return;
      }

      if (msg.type === 'get_users') {
        const userList = Array.from(clients.keys());
        ws.send(JSON.stringify({ type: 'user_list', users: userList }));
        return;
      }

      if (msg.type === 'get_groups') {
        sendGroups(ws, currentUser);
        return;
      }

      if (msg.type === 'get_channels') {
        sendChannels(ws, currentUser);
        return;
      }

      if (msg.type === 'private_message') {
        const { to, text, file } = msg;
        const timestamp = Date.now();
        const newMsg = { from: currentUser, text, file, timestamp };
        // Сохраняем в общий массив (для истории)
        const targetWs = clients.get(to);
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(JSON.stringify({ type: 'new_private_message', ...newMsg }));
        }
        ws.send(JSON.stringify({ type: 'delivered' }));
        return;
      }

      if (msg.type === 'group_message') {
        const { groupId, text, file } = msg;
        const timestamp = Date.now();
        const newMsg = { from: currentUser, text, file, timestamp };
        if (!groupMessages.has(groupId)) groupMessages.set(groupId, []);
        groupMessages.get(groupId).push(newMsg);
        const members = groupMembers.get(groupId) || new Set();
        members.forEach(username => {
          const c = clients.get(username);
          if (c && c.readyState === WebSocket.OPEN) {
            c.send(JSON.stringify({ type: 'new_group_message', groupId, ...newMsg }));
          }
        });
        return;
      }

      if (msg.type === 'create_group') {
        const groupId = nextGroupId++;
        groups.set(groupId, { name: msg.name, owner: currentUser });
        if (!groupMembers.has(groupId)) groupMembers.set(groupId, new Set());
        groupMembers.get(groupId).add(currentUser);
        ws.send(JSON.stringify({ type: 'group_created', groupId, groupName: msg.name }));
        broadcastGroups();
        return;
      }

      if (msg.type === 'create_channel') {
        const isPremium = users.get(currentUser)?.isPremium || currentUser === 'opex';
        if (!isPremium) {
          ws.send(JSON.stringify({ type: 'error', error: 'Premium required' }));
          return;
        }
        const channelId = nextChannelId++;
        channels.set(channelId, { name: msg.name, owner: currentUser, subscribers: 1 });
        if (!channelSubs.has(channelId)) channelSubs.set(channelId, new Set());
        channelSubs.get(channelId).add(currentUser);
        ws.send(JSON.stringify({ type: 'channel_created', channelId, channelName: msg.name }));
        broadcastChannels();
        return;
      }

      if (msg.type === 'get_channel_posts') {
        const posts = channelPosts.get(msg.channelId) || [];
        ws.send(JSON.stringify({ type: 'channel_posts', channelId: msg.channelId, posts }));
        return;
      }

      if (msg.type === 'create_post') {
        const { channelId, text, file } = msg;
        const timestamp = Date.now();
        const post = { id: Date.now(), author: currentUser, text, file, timestamp, comments: [] };
        if (!channelPosts.has(channelId)) channelPosts.set(channelId, []);
        channelPosts.get(channelId).unshift(post);
        const subs = channelSubs.get(channelId) || new Set();
        subs.forEach(username => {
          const c = clients.get(username);
          if (c && c.readyState === WebSocket.OPEN) {
            c.send(JSON.stringify({ type: 'new_post', channelId, ...post }));
          }
        });
        ws.send(JSON.stringify({ type: 'post_created', channelId }));
        return;
      }

      if (msg.type === 'add_comment') {
        const { postId, text } = msg;
        const comment = { id: Date.now(), author: currentUser, text, timestamp: Date.now() };
        if (!comments.has(postId)) comments.set(postId, []);
        comments.get(postId).push(comment);
        // уведомить подписчиков канала (упрощённо)
        ws.send(JSON.stringify({ type: 'comment_added', postId }));
        return;
      }

      if (msg.type === 'get_comments') {
        const postComments = comments.get(msg.postId) || [];
        ws.send(JSON.stringify({ type: 'comments_list', postId: msg.postId, comments: postComments }));
        return;
      }

      if (msg.type === 'send_gift') {
        const { to, gift } = msg;
        gifts.push({ from: currentUser, to, gift, timestamp: Date.now() });
        const targetWs = clients.get(to);
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(JSON.stringify({ type: 'gift_received', from: currentUser, gift }));
        }
        ws.send(JSON.stringify({ type: 'gift_sent' }));
        return;
      }

    } catch(e) {
      console.error(e);
    }
  });

  ws.on('close', () => {
    if (currentUser) {
      clients.delete(currentUser);
      broadcastUserList();
    }
  });
});

function broadcastUserList() {
  const userList = Array.from(clients.keys());
  for (let [username, ws] of clients.entries()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'user_list', users: userList }));
    }
  }
}

function sendGroups(ws, username) {
  const groupList = [];
  for (let [id, group] of groups.entries()) {
    if (groupMembers.get(id)?.has(username)) {
      groupList.push({ id, name: group.name });
    }
  }
  ws.send(JSON.stringify({ type: 'groups_list', groups: groupList }));
}

function sendChannels(ws, username) {
  const channelList = [];
  for (let [id, channel] of channels.entries()) {
    const isSubscribed = channelSubs.get(id)?.has(username) || false;
    channelList.push({
      id,
      name: channel.name,
      owner: channel.owner,
      subscribers: channel.subscribers,
      is_subscribed: isSubscribed
    });
  }
  ws.send(JSON.stringify({ type: 'channels_list', channels: channelList }));
}

function broadcastGroups() {
  for (let [username, ws] of clients.entries()) {
    if (ws.readyState === WebSocket.OPEN) sendGroups(ws, username);
  }
}

function broadcastChannels() {
  for (let [username, ws] of clients.entries()) {
    if (ws.readyState === WebSocket.OPEN) sendChannels(ws, username);
  }
}

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
