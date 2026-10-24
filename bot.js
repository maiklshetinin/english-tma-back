import { Telegraf } from 'telegraf';

const token = process.env.BOT_TOKEN;

if (!token) {
  console.error('Error: BOT_TOKEN is not provided in environment variables!');
  process.exit(1);
}

const bot = new Telegraf(token);

bot.start((ctx) => ctx.reply('Привет! Бот успешно запущен и работает в отдельном репозитории!'));
bot.help((ctx) => ctx.reply('Напиши /start для проверки связи.'));

bot.launch();
console.log('Bot is running...');

// Корректное завершение работы при остановке сервера
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));