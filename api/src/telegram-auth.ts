import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export function verifyTelegramInitData(
  initData: string,
  botToken: string
): TelegramUser | null {
  if (!initData || initData.length > 16_384 || !botToken) {
    return null;
  }

  try {
    const params = new URLSearchParams(initData);
    const receivedHash = params.get('hash');

    if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) {
    console.warn('Telegram auth rejected: missing or invalid hash');
    return null;
    }

    const authDate = Number(params.get('auth_date'));
    const now = Math.floor(Date.now() / 1000);

    if (
      !Number.isSafeInteger(authDate) ||
      authDate > now + 30 ||
      now - authDate > 3600
    ) {
      console.warn('Telegram auth rejected: invalid auth_date');
      return null;
    }

    const userValue = params.get('user');
    if (!userValue) return null;

    const dataCheckString = [...params.entries()]
      .filter(([key]) => key !== 'hash')
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    const secretKey = createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    const calculatedHash = createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest();

    const suppliedHash = Buffer.from(receivedHash, 'hex');

    if (
      suppliedHash.length !== calculatedHash.length ||
      !timingSafeEqual(suppliedHash, calculatedHash)
    ) {
      console.warn('Telegram auth rejected: hash mismatch');
      return null;
    }

    const user = JSON.parse(userValue) as TelegramUser;

    if (
      !Number.isSafeInteger(user.id) ||
      user.id <= 0 ||
      typeof user.first_name !== 'string' ||
      user.first_name.length > 256
    ) {
      return null;
    }

    return user;
  } catch {
    return null;
  }
}
