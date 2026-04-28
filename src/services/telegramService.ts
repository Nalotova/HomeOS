/**
 * Service to send notifications to Telegram via Bot API
 */

const getEnv = (key: string) => {
  if (typeof process !== 'undefined' && process.env) {
    if (process.env[key]) return process.env[key];
    if (process.env[`VITE_${key}`]) return process.env[`VITE_${key}`];
  }
  // @ts-ignore
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    // @ts-ignore
    if (import.meta.env[key]) return import.meta.env[key];
    // @ts-ignore
    if (import.meta.env[`VITE_${key}`]) return import.meta.env[`VITE_${key}`];
  }
  return '';
};

const BOT_TOKEN = (getEnv('TELEGRAM_BOT_TOKEN') || '').trim();
const CHAT_ID = (getEnv('TELEGRAM_CHAT_ID') || '').trim();

export const sendTelegramMessage = async (text: string, replyMarkup?: any): Promise<{success: boolean, error?: string}> => {
  if (!BOT_TOKEN) {
    console.warn('Telegram Notification skipped: VITE_TELEGRAM_BOT_TOKEN is missing');
    return { success: false, error: 'В настройках не указан VITE_TELEGRAM_BOT_TOKEN' };
  }
  if (!CHAT_ID) {
    console.warn('Telegram Notification skipped: VITE_TELEGRAM_CHAT_ID is missing');
    return { success: false, error: 'В настройках не указан VITE_TELEGRAM_CHAT_ID' };
  }

  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: text,
        parse_mode: 'HTML',
        reply_markup: replyMarkup
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Telegram API error response:', errorData);
      return { success: false, error: `Ошибка API: ${errorData.description || response.statusText}` };
    } else {
      console.log('Telegram message sent successfully');
      return { success: true };
    }
  } catch (error) {
    console.error('Failed to send Telegram message (network error):', error);
    return { success: false, error: 'Ошибка сети при отправке в Telegram' };
  }
};
