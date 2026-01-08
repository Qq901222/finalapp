import { Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/* ---------------------- 工具 ---------------------- */
function normalizeKind(k?: string): 'cash' | 'bank' | 'credit' {
  const s = String(k || '').trim().toLowerCase()
  if (s.includes('cash') || s.includes('現金')) return 'cash'
  if (s.includes('credit') || s.includes('card') || s.includes('信用')) return 'credit'
  if (s.includes('bank') || s.includes('銀行')) return 'bank'
  return 'cash'
}

function toNumberOr(v: any, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function toIntOrNull(v: any): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

/* ---------------------- 預設帳戶 ---------------------- */
async function ensureDefaultAccount(userId: number) {
  const exists = await prisma.account.findFirst({ where: { userId } })
  if (!exists) {
    await prisma.account.create({
      data: {
        userId,
        name: '我的現金',
        kind: 'cash',
        balance: 0,
        limitAmount: 0,
      },
    })
    if (process.env.REC_DEBUG === '1')
      console.log('[ACCOUNT INIT] 建立預設現金帳戶 for user', userId)
  }
}

/* ---------------------- Controllers ---------------------- */

// 取得使用者帳戶
export const getAccounts = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    if (!userId) return res.status(401).json({ message: '未登入' })

    await ensureDefaultAccount(userId)
    const kind = req.query.kind ? normalizeKind(req.query.kind as string) : undefined

    const accounts = await prisma.account.findMany({
      where: { userId, ...(kind ? { kind } : {}) },
      orderBy: { id: 'asc' },
    })
    return res.json(accounts)
  } catch (error) {
    console.error('[getAccounts] error:', error)
    return res.status(500).json({ message: '伺服器錯誤' })
  }
}

// 建立帳戶
export const createAccount = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    if (!userId) return res.status(401).json({ message: '未登入' })

    let { name, kind, balance, limitAmount, allowanceDay } = req.body
    name = String(name ?? '').trim()
    if (!name) return res.status(400).json({ message: 'name 為必填' })

    const finalKind = normalizeKind(kind)
    const data = {
      userId,
      name,
      kind: finalKind,
      balance: toNumberOr(balance, 0),
      limitAmount: toNumberOr(limitAmount, 0),
      allowanceDay: toIntOrNull(allowanceDay),
    }

    const account = await prisma.account.create({ data })
    return res.status(201).json(account)
  } catch (error) {
    console.error('[createAccount] error:', error)
    return res.status(500).json({ message: '伺服器錯誤' })
  }
}

// 更新帳戶
export const updateAccount = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    if (!userId) return res.status(401).json({ message: '未登入' })

    const id = Number(req.params.id)
    const account = await prisma.account.findFirst({ where: { id, userId } })
    if (!account) return res.status(404).json({ message: '找不到帳戶或無權限' })

    const body = req.body || {}
    const data: any = {}

    if (body.name !== undefined) data.name = String(body.name).trim()
    if (body.kind !== undefined) data.kind = normalizeKind(body.kind)
    if (body.balance !== undefined) data.balance = toNumberOr(body.balance, account.balance)
    if (body.limitAmount !== undefined) data.limitAmount = toNumberOr(body.limitAmount, account.limitAmount || 0)
    if (body.allowanceDay !== undefined) data.allowanceDay = toIntOrNull(body.allowanceDay)

    const updated = await prisma.account.update({ where: { id }, data })
    return res.json(updated)
  } catch (error) {
    console.error('[updateAccount] error:', error)
    return res.status(500).json({ message: '伺服器錯誤' })
  }
}

// 刪除帳戶（若有交易則禁止）
export const deleteAccount = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    if (!userId) return res.status(401).json({ message: '未登入' })

    const id = Number(req.params.id)
    const account = await prisma.account.findFirst({ where: { id, userId } })
    if (!account) return res.status(404).json({ message: '找不到帳戶或無權限' })

    const txCount = await prisma.record.count({ where: { accountId: id } })
    if (txCount > 0)
      return res.status(400).json({ message: '已有記錄之帳戶不可刪除' })

    await prisma.account.delete({ where: { id } })
    return res.status(204).send()
  } catch (error) {
    console.error('[deleteAccount] error:', error)
    return res.status(500).json({ message: '伺服器錯誤' })
  }
}

// 信用卡還款：從來源帳戶扣款 + 更新信用卡餘額 + 建立還款紀錄
export const repayCreditCard = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    if (!userId) return res.status(401).json({ message: '未登入' })

    const id = Number(req.params.id) // 信用卡帳戶 id
    const { amount, fromAccountId, date, note } = req.body || {}

    const card = await prisma.account.findFirst({ where: { id, userId } })
    if (!card || card.kind !== 'credit')
      return res.status(404).json({ message: '找不到信用卡帳戶或無權限' })

    if (!fromAccountId)
      return res.status(400).json({ message: '需提供來源帳戶 fromAccountId' })

    const srcId = Number(fromAccountId)
    const src = await prisma.account.findFirst({ where: { id: srcId, userId } })
    if (!src) return res.status(404).json({ message: '來源帳戶不存在或無權限' })
    if (src.kind === 'credit')
      return res.status(400).json({ message: '來源帳戶不可為信用卡' })

    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0)
      return res.status(400).json({ message: '還款金額需大於 0' })

    const when = date ? new Date(date) : new Date()

    const result = await prisma.$transaction(async (tx) => {
      const paymentMethod = src.kind === 'cash' ? 'cash' : 'bank'

      const rec = await tx.record.create({
        data: {
          userId,
          accountId: src.id,
          amount: amt,
          category: '信用卡還款',
          note: note ?? `還款至信用卡`,
          paymentMethod,
          createdAt: when,
        },
      })

      const updatedSrc = await tx.account.update({
        where: { id: src.id },
        data: { balance: src.balance - amt },
      })

      const updatedCard = await tx.account.update({
        where: { id: card.id },
        data: { balance: card.balance + amt },
      })

      return { rec, updatedSrc, updatedCard }
    })

    return res.json({
      message: '還款完成',
      record: result.rec,
      fromAccount: result.updatedSrc,
      account: result.updatedCard,
    })
  } catch (error) {
    console.error('[repayCreditCard] error:', error)
    return res.status(500).json({ message: '伺服器錯誤' })
  }
}
