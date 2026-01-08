import { Request, Response } from 'express';
import { convertFx } from '../services/exchangeService';

export async function getExchange(req: Request, res: Response) {
  try {
    const from = String(req.query.from || '');
    const to = String(req.query.to || '');
    if (!/^[A-Za-z]{3}$/.test(from) || !/^[A-Za-z]{3}$/.test(to)) {
      return res.status(400).json({ error: 'invalid_currency_code' });
    }
    const amount = req.query.amount != null ? Number(req.query.amount) : undefined;
    if (amount != null && Number.isNaN(amount)) return res.status(400).json({ error: 'invalid_amount' });

    const data = await convertFx(from, to, amount);
    return res.json(data);
  } catch (e: any) {
    return res.status(500).json({ error: 'exchange_failed', detail: e?.message || String(e) });
  }
}
