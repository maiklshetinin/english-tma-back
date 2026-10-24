import { Telegraf, Markup } from 'telegraf';
import http from 'http';

const token = process.env.BOT_TOKEN;
const frontendUrl = 'https://maiklshetinin.github.io/english-tma/'; 
const PORT = process.env.PORT || 3000;

if (!token) {
  console.error('Error: BOT_TOKEN is not provided in environment variables!');
  process.exit(1);
}

// Поднимаем простой HTTP-сервер, чтобы Render видел открытый порт
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is running and alive!\n');
}).listen(PORT, () => {
  console.log(`HTTP server is listening on port ${PORT}`);
});

const bot = new Telegraf(token);

bot.start((ctx) => {
  ctx.reply(
    'Привет! Добро пожаловать в приложение для изучения английского. Нажми кнопку ниже, чтобы открыть его:',
    Markup.inlineKeyboard([
      [Markup.button.webApp('Открыть приложение 🚀', frontendUrl)]
    ])
  );
});

bot.help((ctx) => ctx.reply('Напиши /start для запуска приложения.'));

bot.launch();
console.log('Bot is running with Web App button...');

// Корректное завершение работы
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));