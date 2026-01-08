import { Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import { createRecordNotification } from './notificationController'
import { hybridClassify, quickClassify } from '../utils/aiFilter'

const prisma = new PrismaClient()

/* =========================
   共用檢查函式
========================= */
async function assertGroupMember(userId: number, groupId: number) {
  const gm = await prisma.groupMember.findFirst({ where: { userId, groupId } })
  if (!gm) {
    const err: any = new Error('無權限存取此群組')
    err.status = 403
    throw err
  }
}

async function assertAccountOwnedByUser(accountId: number, userId: number) {
  const acc = await prisma.account.findUnique({ where: { id: accountId } })
  if (!acc) {
    const err: any = new Error('找不到指定帳戶')
    err.status = 404
    throw err
  }
  if (acc.userId !== userId) {
    const err: any = new Error('無權限使用此帳戶')
    err.status = 403
    throw err
  }
  return acc
}

function isCashLike(kind?: string) {
  const k = String(kind || '').toLowerCase()
  return ['cash', 'bank', '現金', '銀行'].some((x) => k.includes(x))
}

function isCreditCard(kind?: string) {
  const k = String(kind || '').toLowerCase()
  return ['credit', 'card', '信用卡'].some((x) => k.includes(x))
}

/* =========================
   建立記帳紀錄
========================= */
export const createRecord = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    if (!userId) return res.status(401).json({ message: '未登入' })

    const { amount, note, category, accountId, groupId, paymentMethod, quantity = 1 } = req.body
    if (amount === undefined || !accountId || !paymentMethod) {
      return res.status(400).json({ message: '缺少必要欄位 amount / accountId / paymentMethod' })
    }

    if (groupId) await assertGroupMember(userId, Number(groupId))
    const account = await assertAccountOwnedByUser(Number(accountId), userId)

    const qty = Number(quantity) || 1
    const totalAmount = Number(amount) * qty

    // 信用卡額度檢查
    if (totalAmount > 0 && isCreditCard(account.kind) && account.limitAmount) {
      const available = account.limitAmount - Math.max(0, account.balance)
      if (available < totalAmount) {
        return res.status(400).json({
          message: '信用卡額度不足',
          availableCredit: available,
          requiredAmount: totalAmount,
        })
      }
    }

    // AI 分類
    let finalCategory = category
    let classificationSource = 'manual'
    if (!category || category === '未分類') {
      try {
        if (note && note.trim()) {
          const cls = await hybridClassify(note, userId)
          finalCategory = cls.category
          classificationSource = cls.source
        } else {
          finalCategory = '其他'
          classificationSource = 'default'
        }
      } catch {
        try {
          const q = quickClassify(note || '')
          finalCategory = q.category
          classificationSource = 'local_fallback'
        } catch {
          finalCategory = '其他'
          classificationSource = 'error_fallback'
        }
      }
    }

    const createdAtInput = req.body?.createdAt ? new Date(String(req.body.createdAt)) : undefined
    const record = await prisma.record.create({
      data: {
        amount: totalAmount,
        note: note || '',
        category: finalCategory,
        quantity: qty,
        accountId: Number(accountId),
        groupId: groupId ? Number(groupId) : null,
        paymentMethod,
        userId,
        ...(createdAtInput && !isNaN(createdAtInput.getTime()) ? { createdAt: createdAtInput } : {}),
      },
    })

    // 更新帳戶餘額
    let newBalance = account.balance
    if (isCashLike(account.kind)) newBalance -= totalAmount
    if (isCreditCard(account.kind)) newBalance += totalAmount

    await prisma.account.update({
      where: { id: account.id },
      data: { balance: newBalance },
    })

    try {
      await createRecordNotification(userId, {
        amount: totalAmount,
        note: note || '',
        category: finalCategory,
      })
    } catch (e) {
      console.error('建立通知失敗:', e)
    }

    const full = await prisma.record.findUnique({
      where: { id: record.id },
      include: { account: true, group: true, user: true },
    })

    return res.status(201).json({
      ...full,
      classification: {
        category: finalCategory,
        source: classificationSource,
        autoClassified: !category || category === '未分類',
      },
    })
  } catch (err: any) {
    console.error('[createRecord] error:', err)
    return res.status(err?.status || 500).json({ message: err?.message || '伺服器錯誤' })
  }
}

/* =========================
   取得紀錄（個人或群組）
========================= */
export const getRecords = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    if (!userId) return res.status(401).json({ message: '未登入' })

    const { group: groupId, page = 1, limit = 20, category, startDate, endDate } = req.query
    const skip = (Number(page) - 1) * Number(limit)

    let where: any = {}

    // ✅ 群組模式：顯示群組內所有成員的紀錄
    if (groupId) {
      const gid = Number(groupId)
      await assertGroupMember(userId, gid)
      where = {
        groupId: gid,
        group: {
          members: {
            some: { userId },
          },
        },
      }
    }
    // ✅ 個人模式：只顯示自己的紀錄（非群組）
    else {
      where = {
        AND: [{ userId }, { groupId: null }, { account: { userId } }],
      }
    }

    // 篩選條件
    if (category) where.AND = [...(where.AND || []), { category }]
    if (startDate || endDate) {
      const createdAt: any = {}
      if (startDate) createdAt.gte = new Date(String(startDate))
      if (endDate) createdAt.lte = new Date(String(endDate))
      where.AND = [...(where.AND || []), { createdAt }]
    }

    const records = await prisma.record.findMany({
      where,
      include: { account: true, group: true, user: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take: Number(limit),
    })
    const total = await prisma.record.count({ where })

    return res.json({
      records,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    })
  } catch (err: any) {
    console.error('[getRecords] error:', err)
    return res.status(err?.status || 500).json({ message: err?.message || '伺服器錯誤' })
  }
}


/* =========================
   更新記帳紀錄
========================= */
export const updateRecord = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    const id = Number(req.params.id)
    if (!userId) return res.status(401).json({ message: '未登入' })

    const record = await prisma.record.findUnique({ where: { id } })
    if (!record || record.userId !== userId) {
      return res.status(404).json({ message: '找不到記帳紀錄或無權限' })
    }

    const { amount, note, category, quantity } = req.body
    const account = record.accountId
  ? await prisma.account.findUnique({ where: { id: record.accountId } })
  : null
if (!account) return res.status(404).json({ message: '找不到帳戶' })


    const newQty = quantity !== undefined ? Number(quantity) : record.quantity || 1
    const baseAmount = amount !== undefined ? Number(amount) : record.amount / (record.quantity || 1)
    const newTotal = baseAmount * newQty
    const diff = newTotal - record.amount

    // 信用卡額度檢查
    if (diff > 0 && isCreditCard(account.kind) && account.limitAmount) {
      const available = account.limitAmount - Math.max(0, account.balance)
      if (available < diff) {
        return res.status(400).json({
          message: '信用卡額度不足',
          availableCredit: available,
          requiredAmount: diff,
        })
      }
    }

    // 更新帳戶餘額
    let newBalance = account.balance
    if (isCashLike(account.kind)) newBalance -= diff
    if (isCreditCard(account.kind)) newBalance += diff
    await prisma.account.update({ where: { id: account.id }, data: { balance: newBalance } })

    // 分類修正
    let finalCategory = category
    if ((!category || category === '未分類') && note) {
      try {
        const cls = await hybridClassify(note, userId)
        finalCategory = cls.category
      } catch {
        finalCategory = category ?? record.category
      }
    }

    const updated = await prisma.record.update({
      where: { id },
      data: {
        amount: newTotal,
        note: note ?? record.note,
        category: finalCategory,
        quantity: newQty,
      },
      include: { account: true, group: true, user: true },
    })

    return res.json(updated)
  } catch (err) {
    console.error('[updateRecord] error:', err)
    return res.status(500).json({ message: '伺服器錯誤' })
  }
}

/* =========================
   刪除記帳紀錄
========================= */
export const deleteRecord = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    const id = Number(req.params.id)
    if (!userId) return res.status(401).json({ message: '未登入' })

    const record = await prisma.record.findUnique({ where: { id } })
    if (!record || record.userId !== userId) {
      return res.status(404).json({ message: '找不到記帳紀錄或無權限' })
    }

    const account = record.accountId
  ? await prisma.account.findUnique({ where: { id: record.accountId } })
  : null
if (account) {
  let newBalance = account.balance
  if (isCashLike(account.kind)) newBalance += record.amount
  if (isCreditCard(account.kind)) newBalance -= record.amount
  await prisma.account.update({ where: { id: account.id }, data: { balance: newBalance } })
}

    await prisma.record.delete({ where: { id } })
    return res.status(204).send()
  } catch (err) {
    console.error('[deleteRecord] error:', err)
    return res.status(500).json({ message: '伺服器錯誤' })
  }
}

/* =========================
   統計紀錄（個人或群組）
========================= */
export const getRecordStats = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    if (!userId) return res.status(401).json({ message: '未登入' })

    const { group: groupId, month } = req.query
    let where: any = {}

    if (groupId) {
      const gid = Number(groupId)
      await assertGroupMember(userId, gid)
      where.groupId = gid
    } else {
      where = {
        AND: [{ userId }, { groupId: null }, { account: { userId } }],
      }
    }

    if (month) {
      const start = new Date(String(month))
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999)
      where.AND = [...(where.AND || []), { createdAt: { gte: start, lte: end } }]
    }

    const records = await prisma.record.findMany({
      where,
      select: { amount: true, category: true },
    })

    const totalAmount = records.reduce((s, r) => s + r.amount, 0)
    const categoryStats = records.reduce((acc: Record<string, number>, r) => {
    const key = r.category ?? '未分類'
  acc[key] = (acc[key] || 0) + r.amount
  return acc
  }, {})

    const topCategories = Object.entries(categoryStats)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([category, amount]) => ({ category, amount }))

    return res.json({ totalAmount, totalRecords: records.length, categoryStats, topCategories })
  } catch (err: any) {
    console.error('[getRecordStats] error:', err)
    return res.status(err?.status || 500).json({ message: err?.message || '伺服器錯誤' })
  }
}
/* =========================
   建立含圖片的記帳紀錄
========================= */
export const createRecordWithImage = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    if (!userId) return res.status(401).json({ message: '未登入' })

    // 檢查有無上傳圖片
    if (!req.file) return res.status(400).json({ message: '未上傳圖片' })

    // 將圖片檔名加入 body
    const body = { ...req.body, image: req.file.filename }

    // 讓 createRecord 使用相同邏輯（帶上圖片）
    req.body = body
    return await createRecord(req, res)
  } catch (err) {
    console.error('[createRecordWithImage] error:', err)
    return res.status(500).json({ message: '伺服器錯誤' })
  }
}

/* =========================
   取得登入者的個人紀錄
========================= */
export const getPersonalRecords = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    if (!userId) return res.status(401).json({ message: '未登入' })

    // 清除群組參數，確保查詢個人紀錄
    req.query.group = undefined
    return await getRecords(req, res)
  } catch (err) {
    console.error('[getPersonalRecords] error:', err)
    return res.status(500).json({ message: '伺服器錯誤' })
  }
}
