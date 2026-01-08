import axios from 'axios';

const http = axios.create({ timeout: 10000 });

// === 基本設定 ===
const TTL_MS = 60 * 1000; // 快取時間 60 秒
const FAIL_LIMIT = 3;     // 熔斷閾值
const COOLDOWN_MS = 30 * 1000; // 熔斷維持時間

// === 快取與狀態 ===
const cache = new Map<string, { rate: number; ts: number }>();
let failCount = 0;
let circuitOpen = false;
let lastFail = 0;

// === 外部 API 嘗試鏈 ===
async function viaERHostConvert(f: string, t: string) {
  const { data } = await http.get('https://api.exchangerate.host/convert', {
    params: { from: f, to: t, amount: 1 },
  });
  const rate = Number(data?.info?.rate ?? data?.result);
  if (Number.isFinite(rate) && rate > 0) return { rate, provider: 'exchangerate.host/convert' };
  throw new Error('no_rate');
}

async function viaERHostLatest(f: string, t: string) {
  const { data } = await http.get('https://api.exchangerate.host/latest', {
    params: { base: f, symbols: t },
  });
  const rate = Number(data?.rates?.[t]);
  if (Number.isFinite(rate) && rate > 0) return { rate, provider: 'exchangerate.host/latest' };
  throw new Error('no_rate');
}

async function viaOpenER(f: string, t: string) {
  const { data } = await http.get(`https://open.er-api.com/v6/latest/${f}`);
  const rate = Number(data?.rates?.[t]);
  if (data?.result === 'success' && Number.isFinite(rate) && rate > 0)
    return { rate, provider: 'open.er-api.com' };
  throw new Error('no_rate');
}

async function viaJsDelivr(f: string, t: string) {
  const { data } = await http.get(
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${f.toLowerCase()}.json`
  );
  const rate = Number(data?.[f.toLowerCase()]?.[t.toLowerCase()]);
  if (Number.isFinite(rate) && rate > 0)
    return { rate, provider: 'jsdelivr-currency-api' };
  throw new Error('no_rate');
}

// === 主邏輯 ===
export async function convertFx(from: string, to: string, amount?: number) {
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  const amt = amount != null ? Number(amount) : undefined;
  const key = `${f}_${t}`;
  const now = Date.now();

  // 檢查快取
  const cached = cache.get(key);
  if (cached && now - cached.ts < TTL_MS) {
    if (process.env.DEBUG_FX === '1')
      console.log(`[FX] cache hit for ${key}`);
    return {
      from: f, to: t, rate: cached.rate,
      amount: amt ?? null,
      result: amt != null ? amt * cached.rate : null,
      provider: 'cache',
      cached: true
    };
  }

  // 熔斷保護
  if (circuitOpen && now - lastFail < COOLDOWN_MS) {
    throw new Error('circuit_open'); // 太多失敗暫時停止
  }

  const chain = [viaERHostConvert, viaERHostLatest, viaOpenER, viaJsDelivr];
  let out: any = null;

  try {
    for (const fn of chain) {
      try {
        out = await fn(f, t);
        break;
      } catch {}
    }
    if (!out) throw new Error('no_provider_success');

    // 成功 → 重設錯誤計數
    failCount = 0;
    circuitOpen = false;

    // 更新快取
    cache.set(key, { rate: out.rate, ts: now });

    return {
      from: f, to: t, rate: out.rate,
      amount: amt ?? null,
      result: amt != null ? amt * out.rate : null,
      provider: out.provider,
      cached: false
    };
  } catch (err) {
    // 記錄錯誤次數
    failCount++;
    lastFail = now;
    if (failCount >= FAIL_LIMIT) circuitOpen = true;

    throw err;
  }
}
