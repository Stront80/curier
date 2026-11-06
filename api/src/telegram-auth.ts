import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

function optionalString(value: unknown, maxLength: number): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= maxLength);
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
    const entries = [...params.entries()];

    // Duplicate keys can make validation ambiguous across parsers.
    if (new Set(entries.map(([key]) => key)).size !== entries.length) {
      return null;
    }

    const receivedHash = params.get('hash');
    if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) {
      return null;
    }

    const authDate = Number(params.get('auth_date'));
    const now = Math.floor(Date.now() / 1000);
    if (
      !Number.isSafeInteger(authDate) ||
      authDate <= 0 ||
      authDate > now + 30 ||
      now - authDate > 3600
    ) {
      return null;
    }

    const userValue = params.get('user');
    if (!userValue) return null;

    const dataCheckString = entries
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
      return null;
    }

    const parsed: unknown = JSON.parse(userValue);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    const user = parsed as Record<string, unknown>;
    if (
      !Number.isSafeInteger(user.id) ||
      (user.id as number) <= 0 ||
      typeof user.first_name !== 'string' ||
      user.first_name.length === 0 ||
      user.first_name.length > 256 ||
      !optionalString(user.last_name, 256) ||
      !optionalString(user.username, 64) ||
      !optionalString(user.language_code, 16)
    ) {
      return null;
    }

    return user as unknown as TelegramUser;
  } catch {
    return null;
  }
}
