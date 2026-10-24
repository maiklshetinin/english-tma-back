import { Telegraf, Markup } from 'telegraf';

const token = process.env.BOT_TOKEN;
// Укажи здесь ссылку на твой сайт на GitHub Pages
const frontendUrl = 'https://maiklshetinin.github.io/english-tma/'; 

if (!token) {
  console.error('Error: BOT_TOKEN is not provided in environment variables!');
  process.exit(1);
}

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