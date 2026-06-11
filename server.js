const express = require('express');
const http = require('http');

const app = express();
const server = http.createServer(app);

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><title>Telegram Premium</title></head>
    <body style="background:#0e1621;color:white;font-family:system-ui;text-align:center;padding:40px;">
      <h1>✅ Сервер работает!</h1>
      <p>Если вы видите это — деплой успешен.</p>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
