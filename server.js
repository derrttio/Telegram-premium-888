const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><title>Telegram Clone</title></head>
    <body style="background:#0e1621;color:white;font-family:system-ui;text-align:center;padding:40px;">
      <h1>✅ Сервер запущен!</h1>
      <p>Если ты видишь это — деплой успешен.</p>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
