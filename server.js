const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- Хранилище в памяти ---
let users = [];            // { username, isPremium, lastSeen }
let messages = [];         // { from, to, text, file, timestamp }
let groups = [];
let groupMembers = [];
let groupMessages = [];
let channels = [];
let channelSubs = [];
let channelPosts = [];
let comments = [];
let gifts = [];

// Премиум для opex (при старте сервера)
if (!users.find(u => u.username === 'opex')) {
  users.push({ username: 'opex', isPremium: true, lastSeen: Date.now() });
} else {
  const o = users.find(u => u.username === 'opex');
  if (o) o.isPremium = true;
}

const clients = new Map();  // username -> WebSocket

// ---- Вспомогательные функции для отправки списков ----
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
    .map(gm => {
      const g = groups.find(g => g.id === gm.group_id);
      return g ? { id: g.id, name: g.name } : null;
    })
    .filter(g => g);
  ws.send(JSON.stringify({ type: 'groups_list', groups: myGroups }));
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

// ---- HTML интерфейс (такой же, как раньше, для краткости оставлен тот же) ----
// (полный htmlPage такой же, как в предыдущих сообщениях, я его сокращать не буду, 
//  но вставлю полностью, чтобы ты скопировал и всё работало)

const htmlPage = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>Telegram Premium</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box;}body{background:#0a0c10;font-family:system-ui;height:100vh;overflow:hidden;}
    .login-screen{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:radial-gradient(circle at 20% 30%,#0f1219,#07090e);}
    .logo{font-size:32px;font-weight:800;margin-bottom:40px;background:linear-gradient(135deg,#fff,#e6b800);-webkit-background-clip:text;background-clip:text;color:transparent;}
    .login-card{width:280px;background:rgba(30,34,48,0.8);backdrop-filter:blur(16px);border-radius:28px;padding:20px;border:1px solid rgba(255,215,0,0.3);}
    .login-card input{width:100%;background:#1e202a;border:1px solid #2a2e3a;border-radius:28px;padding:14px;color:#fff;margin-bottom:16px;}
    .login-card button{width:100%;background:linear-gradient(135deg,#e6b800,#ffd700);border:none;border-radius:32px;padding:12px;font-weight:bold;color:#121212;}
    .main{display:flex;height:100vh;}.sidebar{width:320px;background:#17212b;border-right:1px solid #2b2f3a;display:flex;flex-direction:column;}
    .sidebar-header{padding:16px;border-bottom:1px solid #2b2f3a;}.user-info{display:flex;align-items:center;gap:12px;}
    .avatar{width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#ffd700,#e6b800);display:flex;align-items:center;justify-content:center;font-weight:bold;color:#1e1e2a;}
    .username{font-weight:600;color:#fff;}.premium-badge{font-size:10px;background:#ffd700;color:#1e1e2a;padding:2px 8px;border-radius:20px;display:inline-block;}
    .search-bar{padding:12px;}.search-bar input{width:100%;background:#1e202a;border:none;border-radius:24px;padding:10px;color:#fff;}
    .tabs{display:flex;padding:0 12px;gap:8px;margin-bottom:12px;}.tab{flex:1;background:transparent;border:none;color:#8e9aaf;padding:8px;border-radius:20px;cursor:pointer;}
    .tab.active{background:#2b5278;color:#fff;}.dynamic-list{flex:1;overflow-y:auto;padding:0 8px;}
    .item{display:flex;align-items:center;gap:12px;padding:10px;border-radius:14px;margin-bottom:2px;cursor:pointer;}
    .item:hover{background:#1e2a36;}.item .avatar{width:44px;height:44px;background:#2a2e3a;color:#fff;}.item .name{flex:1;color:#fff;}
    .action-buttons{padding:16px;display:flex;gap:10px;border-top:1px solid #2b2f3a;}
    .action-btn{flex:1;background:#2b5278;border:none;border-radius:28px;padding:10px;color:#fff;cursor:pointer;}
    .chat-area{flex:1;display:flex;flex-direction:column;background:#0e1621;}
    .chat-header{padding:16px;background:#17212b;border-bottom:1px solid #2b2f3a;color:#fff;font-weight:600;display:flex;justify-content:space-between;}
    .messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px;}
    .message{max-width:75%;padding:10px 14px;border-radius:20px;font-size:15px;}
    .message.out{background:linear-gradient(135deg,#2a6c4e,#1f5a41);color:#fff;align-self:flex-end;}
    .message.in{background:#1e2a36;color:#fff;align-self:flex-start;}
    .post{background:#17212b;border-radius:20px;padding:16px;margin-bottom:16px;border-left:3px solid #ffd700;}
    .post-header{color:#ffd966;font-size:13px;margin-bottom:8px;}
    .post-text{color:#fff;margin-bottom:12px;}
    .comments-container{margin-top:12px;padding-left:16px;border-left:2px solid #ffd700;}
    .comment{background:#1e2a36;border-radius:16px;padding:8px;margin-bottom:8px;}
    .add-comment{display:flex;gap:8px;margin-top:10px;}
    .add-comment input{flex:1;background:#1e202a;border:1px solid #2a2e3a;border-radius:28px;padding:8px;color:#fff;}
    .add-comment button{background:#2b5278;border:none;border-radius:28px;width:44px;cursor:pointer;color:#fff;}
    .input-area{display:flex;gap:10px;padding:12px;background:#17212b;border-top:1px solid #2b2f3a;}
    .input-area input{flex:1;background:#1e202a;border:none;border-radius:28px;padding:12px;color:#fff;}
    .attach-btn,.send-btn,.sticker-btn,.gift-btn{background:#2b5278;border:none;border-radius:32px;width:48px;cursor:pointer;color:#fff;font-size:20px;}
    .sticker-panel,.gift-panel{position:fixed;bottom:70px;left:0;right:0;background:#17212b;border-radius:20px 20px 0 0;padding:12px;display:flex;flex-wrap:wrap;gap:8px;z-index:100;border-top:1px solid #ffd700;}
    .sticker{width:60px;height:60px;background:#1e202a;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:40px;cursor:pointer;}
    .placeholder{text-align:center;color:#6c7883;padding:40px;}
    @media (max-width:700px){.sidebar{width:80px;}.sidebar .user-details,.sidebar .search-bar,.sidebar .item .name{display:none;}}
  </style>
</head>
<body>
<div id="loginScreen" class="login-screen"><div class="logo">✧ Telegram Premium ✧</div><div class="login-card"><input id="username" placeholder="Ваше имя"><button id="loginBtn">Войти</button></div></div>
<div id="main" class="main" style="display:none"><div class="sidebar"><div class="sidebar-header"><div class="user-info"><div id="userAvatar" class="avatar"></div><div><div id="usernameDisplay" class="username"></div><div id="premiumBadge" class="premium-badge" style="display:none">PREMIUM</div></div></div></div><div class="search-bar"><input id="searchInput" placeholder="Поиск"></div><div class="tabs"><button class="tab active" data-view="chats">💬 Чаты</button><button class="tab" data-view="groups">👥 Группы</button><button class="tab" data-view="channels">📢 Каналы</button></div><div id="dynamicList" class="dynamic-list"></div><div class="action-buttons"><button id="createGroupBtn" class="action-btn">+ Группа</button><button id="createChannelBtn" class="action-btn">+ Канал</button></div></div><div class="chat-area"><div class="chat-header" id="chatHeader"><span id="chatTitle">Выберите чат</span><div><button id="giftBtn" class="gift-btn" style="display:none">🎁</button></div></div><div id="messages" class="messages"><div class="placeholder">✨ Telegram Premium ✨</div></div><div class="input-area"><button id="stickerBtn" class="sticker-btn">😊</button><button id="attachBtn" class="attach-btn">📎</button><input id="messageInput" placeholder="Сообщение..."><input type="file" id="fileInput" style="display:none"><button id="sendBtn" class="send-btn">➤</button></div></div></div>
<div id="stickerPanel" class="sticker-panel" style="display:none"><div class="sticker" data-sticker="😀">😀</div><div class="sticker" data-sticker="😂">😂</div><div class="sticker" data-sticker="❤️">❤️</div><div class="sticker" data-sticker="🔥">🔥</div><div class="sticker" data-sticker="✨">✨</div><div class="sticker" data-sticker="🎉">🎉</div><div class="sticker" data-sticker="🥳">🥳</div><div class="sticker" data-sticker="💎">💎</div><div class="sticker" data-sticker="⭐️">⭐️</div><div class="sticker" data-sticker="🏆">🏆</div><div class="sticker" data-sticker="🤣">🤣</div><div class="sticker" data-sticker="😎">😎</div><div class="sticker" data-sticker="😍">😍</div><div class="sticker" data-sticker="😭">😭</div><div class="sticker" data-sticker="🤔">🤔</div><div class="sticker" data-sticker="👍">👍</div><div class="sticker" data-sticker="👎">👎</div><div class="sticker" data-sticker="🙏">🙏</div><div class="sticker" data-sticker="💪">💪</div><div class="sticker" data-sticker="🤝">🤝</div></div>
<div id="giftPanel" class="gift-panel" style="display:none"><div class="sticker" data-gift="🎁 Подарок">🎁</div><div class="sticker" data-gift="🎈 Шарик">🎈</div><div class="sticker" data-gift="🎂 Торт">🎂</div><div class="sticker" data-gift="💐 Цветы">💐</div><div class="sticker" data-gift="🍫 Шоколад">🍫</div></div>
<script>
let ws, currentUser, currentChat=null, currentView='chats', groups=[], channels=[], users=[], messagesCache={}, isPremium=false;
const loginScreen=document.getElementById('loginScreen'), mainDiv=document.getElementById('main'), usernameInput=document.getElementById('username'), loginBtn=document.getElementById('loginBtn');
const dynamicList=document.getElementById('dynamicList'), messagesDiv=document.getElementById('messages'), messageInput=document.getElementById('messageInput'), sendBtn=document.getElementById('sendBtn');
const chatHeader=document.getElementById('chatHeader'), chatTitle=document.getElementById('chatTitle'), userAvatar=document.getElementById('userAvatar'), usernameDisplay=document.getElementById('usernameDisplay'), premiumBadge=document.getElementById('premiumBadge');
const createGroupBtn=document.getElementById('createGroupBtn'), createChannelBtn=document.getElementById('createChannelBtn'), fileInput=document.getElementById('fileInput'), attachBtn=document.getElementById('attachBtn'), searchInput=document.getElementById('searchInput');
const stickerBtn=document.getElementById('stickerBtn'), stickerPanel=document.getElementById('stickerPanel'), giftBtn=document.getElementById('giftBtn'), giftPanel=document.getElementById('giftPanel');

loginBtn.onclick=()=>{let name=usernameInput.value.trim();if(name)currentUser=name,connect();};
function connect(){const p=location.protocol==='https:'?'wss':'ws'; ws=new WebSocket(p+'://'+location.host); ws.onopen=()=>ws.send(JSON.stringify({type:'auth',userId:currentUser})); ws.onmessage=e=>handle(JSON.parse(e.data)); ws.onclose=()=>setTimeout(connect,3000);}
function handle(m){if(m.type==='auth_ok'){loginScreen.style.display='none';mainDiv.style.display='flex';isPremium=m.isPremium;usernameDisplay.innerText=currentUser;userAvatar.innerText=currentUser.charAt(0).toUpperCase();if(isPremium)premiumBadge.style.display='inline-block';loadData();}
else if(m.type==='user_list'){users=m.users.filter(u=>u!==currentUser);if(currentView==='chats')renderUsers();}
else if(m.type==='groups_list'){groups=m.groups;if(currentView==='groups')renderGroups();}
else if(m.type==='channels_list'){channels=m.channels;if(currentView==='channels')renderChannels();}
else if(m.type==='new_private_message'){addMsg('private',m.from,m);if(currentChat&&currentChat.type==='user'&&currentChat.id===m.from)renderMsgs();}
else if(m.type==='new_group_message'){addMsg('group',m.groupId,m);if(currentChat&&currentChat.type==='group'&&currentChat.id===m.groupId)renderMsgs();}
else if(m.type==='channel_posts'){messagesCache['channel_'+m.channelId]=m.posts;if(currentChat&&currentChat.type==='channel'&&currentChat.id===m.channelId)renderPosts();}
else if(m.type==='new_post'){let k='channel_'+m.channelId;if(!messagesCache[k])messagesCache[k]=[];messagesCache[k].unshift(m);if(currentChat&&currentChat.type==='channel'&&currentChat.id===m.channelId)renderPosts();}
else if(m.type==='comments_list')displayComments(m.postId,m.comments);
else if(m.type==='gifts_list'){let html='<div class="section">ПОДАРКИ</div>';m.gifts.forEach(g=>{html+='<div class="item">🎁 от '+escapeHtml(g.from_user)+': '+g.gift_type+'</div>';});if(m.gifts.length===0)html+='<div class="placeholder">Нет подарков</div>';document.getElementById('dynamicList').innerHTML=html;}}
function loadData(){ws.send(JSON.stringify({type:'get_users'}));ws.send(JSON.stringify({type:'get_groups'}));ws.send(JSON.stringify({type:'get_channels'}));}
function renderUsers(){let h='<div class="section">КОНТАКТЫ</div>';users.forEach(u=>{let gold=isPremium&&u===currentUser?'⭐':''; h+='<div class="item" data-user="'+u+'"><div class="avatar">'+u.charAt(0)+'</div><div class="name">'+u+gold+'</div></div>';});dynamicList.innerHTML=h;document.querySelectorAll('[data-user]').forEach(el=>el.onclick=()=>openChat({type:'user',id:el.getAttribute('data-user'),name:el.getAttribute('data-user')}));}
function renderGroups(){let h='<div class="section">ГРУППЫ</div>';groups.forEach(g=>{h+='<div class="item" data-group="'+g.id+'"><div class="avatar">👥</div><div class="name">'+escapeHtml(g.name)+'</div></div>';});dynamicList.innerHTML=h;document.querySelectorAll('[data-group]').forEach(el=>el.onclick=()=>openChat({type:'group',id:parseInt(el.getAttribute('data-group')),name:el.querySelector('.name').innerText}));}
function renderChannels(){let h='<div class="section">КАНАЛЫ</div>';channels.forEach(ch=>{let sub=ch.is_subscribed?'✅':'🔔';h+='<div class="item" data-channel="'+ch.id+'"><div class="avatar">📢</div><div class="name">'+escapeHtml(ch.name)+' '+sub+'</div><div class="subscribers">👥 '+ch.subscribers+'</div></div>';});dynamicList.innerHTML=h;document.querySelectorAll('[data-channel]').forEach(el=>el.onclick=()=>openChat({type:'channel',id:parseInt(el.getAttribute('data-channel')),name:el.querySelector('.name').innerText.replace(/[✅🔔]/g,'').trim()}));}
function openChat(chat){currentChat=chat;chatTitle.innerText=chat.name;giftBtn.style.display=(chat.type==='user')?'inline-block':'none';if(chat.type==='channel')ws.send(JSON.stringify({type:'get_channel_posts',channelId:chat.id}));else ws.send(JSON.stringify({type:'get_history',chatType:chat.type,chatId:chat.id}));}
function addMsg(type,id,m){let k=type+'_'+id;if(!messagesCache[k])messagesCache[k]=[];messagesCache[k].push(m);}
function renderMsgs(){if(!currentChat)return;let msgs=messagesCache[currentChat.type+'_'+currentChat.id]||[];messagesDiv.innerHTML='';msgs.forEach(m=>{let d=document.createElement('div');d.className='message '+(m.from===currentUser?'out':'in');let content=escapeHtml(m.text||'');if(m.file){if(m.file.startsWith('data:image'))content+='<img src="'+m.file+'" style="max-width:150px">';else content+='<a href="'+m.file+'">📎</a>';}d.innerHTML=content+'<div class="time">'+new Date(m.timestamp).toLocaleTimeString()+'</div>';messagesDiv.appendChild(d);});messagesDiv.scrollTop=messagesDiv.scrollHeight;}
function renderPosts(){if(!currentChat||currentChat.type!=='channel')return;let posts=messagesCache['channel_'+currentChat.id]||[];messagesDiv.innerHTML='';posts.forEach(p=>{let d=document.createElement('div');d.className='post';d.innerHTML='<div class="post-header">📢 '+escapeHtml(p.author)+' · '+new Date(p.timestamp).toLocaleString()+'</div><div class="post-text">'+escapeHtml(p.text)+'</div>'+(p.file?(p.file.startsWith('data:image')?'<img src="'+p.file+'" style="max-width:100%;border-radius:16px">':'<a href="'+p.file+'">Файл</a>'):'')+'<button class="show-comments" data-post="'+p.id+'">💬 Комментарии</button><div class="comments-container" id="comments-'+p.id+'" style="display:none"></div><div class="add-comment"><input id="comment-input-'+p.id+'" placeholder="Комментарий..."><button onclick="addComment('+p.id+')">➤</button></div>';messagesDiv.appendChild(d);});document.querySelectorAll('.show-comments').forEach(btn=>{btn.onclick=()=>{let pid=btn.getAttribute('data-post'),c=document.getElementById('comments-'+pid);if(c.style.display==='none'){ws.send(JSON.stringify({type:'get_comments',postId:pid}));c.style.display='block';}else c.style.display='none';};});}
function displayComments(pid,comments){let c=document.getElementById('comments-'+pid);if(!c)return;let h='';comments.forEach(cm=>{h+='<div class="comment"><strong>'+escapeHtml(cm.author)+'</strong>: '+escapeHtml(cm.text)+' <span class="time">'+new Date(cm.timestamp).toLocaleTimeString()+'</span></div>';});c.innerHTML=h;}
window.addComment=function(pid){let inp=document.getElementById('comment-input-'+pid);let text=inp.value.trim();if(text){ws.send(JSON.stringify({type:'add_comment',postId:pid,text}));inp.value='';}};
sendBtn.onclick=()=>{if(!currentChat)return;let text=messageInput.value.trim(),file=fileInput.files[0];if(!text&&!file)return;if(file){let r=new FileReader();r.onload=e=>{ws.send(JSON.stringify({type:currentChat.type+'_message',to:currentChat.id,text:text||'',file:e.target.result}));messageInput.value='';fileInput.value='';};r.readAsDataURL(file);}else{ws.send(JSON.stringify({type:currentChat.type+'_message',to:currentChat.id,text}));messageInput.value='';}};
attachBtn.onclick=()=>fileInput.click();
stickerBtn.onclick=()=>{stickerPanel.style.display=stickerPanel.style.display==='none'?'flex':'none';giftPanel.style.display='none';};
giftBtn.onclick=()=>{giftPanel.style.display=giftPanel.style.display==='none'?'flex':'none';stickerPanel.style.display='none';};
document.querySelectorAll('.sticker').forEach(s=>{s.onclick=()=>{let sticker=s.getAttribute('data-sticker')||s.innerText;if(currentChat)ws.send(JSON.stringify({type:currentChat.type+'_message',to:currentChat.id,text:sticker}));stickerPanel.style.display='none';};});
document.querySelectorAll('[data-gift]').forEach(g=>{g.onclick=()=>{let gift=g.getAttribute('data-gift');if(currentChat&&currentChat.type==='user'){ws.send(JSON.stringify({type:'send_gift',to:currentChat.id,gift}));giftPanel.style.display='none';alert('Подарок отправлен!');}};});
createGroupBtn.onclick=()=>{let n=prompt('Название группы');if(n)ws.send(JSON.stringify({type:'create_group',name:n}));};
createChannelBtn.onclick=()=>{let n=prompt('Название канала');if(n)ws.send(JSON.stringify({type:'create_channel',name:n}));};
document.querySelectorAll('.tab').forEach(btn=>{btn.onclick=()=>{document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));btn.classList.add('active');currentView=btn.getAttribute('data-view');currentChat=null;chatTitle.innerText='📌 '+currentView.toUpperCase();giftBtn.style.display='none';messagesDiv.innerHTML='<div class="placeholder">Выберите чат</div>';if(currentView==='chats')renderUsers();else if(currentView==='groups')renderGroups();else if(currentView==='channels')renderChannels();};});
function escapeHtml(str){if(!str)return '';return str.replace(/[&<>]/g,m=>m==='&'?'&amp;':m==='<'?'&lt;':'&gt;');}
</script>
</body></html>`;

app.get('/', (req, res) => res.send(htmlPage));

// --- WebSocket обработка (на массивах
