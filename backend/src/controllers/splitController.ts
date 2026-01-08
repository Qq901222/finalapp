import { Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/* =========================
   建立分帳紀錄（含外幣）
========================= */
export const createSplit = async (req: Request, res: Response) => {
  try {
    const {
      groupId,
      amount,
      paidById,
      participants,
      description,
      dueType,
      originalAmount,
      originalCurrency,
      exchangeRate,
    } = req.body

    // -------- 檢查必要欄位 --------
    if (!groupId || !amount || !paidById || !participants?.length) {
      return res.status(400).json({ message: '缺少必要欄位' })
    }

    const totalParticipantAmount = participants.reduce(
      (sum: number, p: { amount: number }) => sum + Number(p.amount),
      0
    )
    const splitAmount = Number(amount)

    // -------- 金額驗證邏輯（台幣才檢查） --------
    if (!originalCurrency || originalCurrency === 'TWD') {
      if (Math.abs(totalParticipantAmount - splitAmount) > 0.01) {
        return res.status(400).json({
          message: '參與者金額總和與分帳金額不符',
          expected: splitAmount,
          actual: totalParticipantAmount,
        })
      }
    }

    // -------- 檢查付款者必須在參與者中 --------
    const paidByInParticipants = participants.find(
      (p: { userId: number }) => Number(p.userId) === Number(paidById)
    )
    if (!paidByInParticipants) {
      return res.status(400).json({ message: '付款者必須是參與者之一' })
    }

    // -------- 建立分帳主紀錄 --------
    const split = await prisma.split.create({
      data: {
        groupId: Number(groupId),
        amount: splitAmount, // 換算後台幣
        paidById: Number(paidById),
        description,
        dueType,
        originalAmount: originalAmount ? Number(originalAmount) : null,
        originalCurrency: originalCurrency || null,
        exchangeRate: exchangeRate ? Number(exchangeRate) : null,
      },
    })

    // -------- 建立參與者紀錄 --------
    await prisma.splitParticipant.createMany({
  data: participants.map((p: { userId: number; amount: number }) => ({
    splitId: split.id,
    userId: Number(p.userId),
    // 🟢 統一換算為台幣金額
    amount: Number(p.amount) * (exchangeRate || 1),
    settled: p.userId === Number(paidById),
  })),
})

    // -------- 查詢完整紀錄回傳 --------
    const fullSplit = await prisma.split.findUnique({
      where: { id: split.id },
      include: {
        participants: { include: { user: true } },
        paidBy: true,
        group: true,
      },
    })

    res.status(201).json(fullSplit)
  } catch (err) {
    console.error('建立分帳失敗:', err)
    res.status(500).json({ message: '建立失敗', error: err })
  }
}

/* =========================
   查詢某群組的分帳紀錄（含原幣資訊）
========================= */
export const getSplits = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    const groupId = Number(req.query.group || req.query.groupId)

    if (!userId) return res.status(401).json({ message: '未登入' })
    if (!groupId) return res.status(400).json({ message: '缺少 groupId' })

    const splits = await prisma.split.findMany({
      where: {
        groupId,
        OR: [{ paidById: userId }, { participants: { some: { userId } } }],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        participants: { include: { user: true } },
        paidBy: true,
        group: true,
      },
    })

    // 顯示格式：若有原幣 → 顯示 USD 30 ≈ NT$975
    const formatted = splits.map((s) => ({
      ...s,
      displayAmount: s.originalCurrency
        ? `${s.originalCurrency} ${s.originalAmount ?? '?'} ≈ NT$${s.amount}`
        : `NT$${s.amount}`,
    }))

    res.json(formatted)
  } catch (err) {
    console.error('查詢分帳失敗:', err)
    res.status(500).json({ message: '查詢失敗', error: err })
  }
}

/* =========================
   結算分帳（付款者操作）
========================= */
export const settleSplit = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    const splitId = Number(req.params.id)

    if (!userId || isNaN(splitId)) {
      return res.status(400).json({ message: '缺少 userId 或無效分帳 ID' })
    }

    const split = await prisma.split.findUnique({
      where: { id: splitId },
      include: { participants: true },
    })
    if (!split) return res.status(404).json({ message: '找不到分帳紀錄' })
    if (split.paidById !== userId)
      return res.status(403).json({ message: '無權限結算此分帳' })
    if (split.settled)
      return res.status(409).json({ message: '分帳已結清' })

    const unpaid = split.participants.filter((p) => !p.settled)
    if (unpaid.length > 0) {
      return res.status(400).json({
        message: '尚有參與者未付款',
        unpaidParticipants: unpaid.map((p) => ({
          userId: p.userId,
          amount: p.amount,
        })),
      })
    }

    await prisma.$transaction(async (tx) => {
      await tx.split.update({ where: { id: splitId }, data: { settled: true } })

      // ✅ 安全建立通知接收者清單（過濾 null）
      const receiverIds = new Set<number>()
      if (split.paidById) receiverIds.add(split.paidById)
      for (const p of split.participants) receiverIds.add(p.userId)

      const message = `「${split.description ?? '分帳'}」已完成還款`
      await tx.notification.createMany({
        data: Array.from(receiverIds).map((uid) => ({
          userId: uid,
          message,
          read: false,
        })),
      })
    })

    res.json({ message: '分帳已結算' })
  } catch (err) {
    console.error('結算失敗:', err)
    res.status(500).json({ message: '結算失敗', error: err })
  }
}

/* =========================
   參與者標記已付款
========================= */
export const markParticipantPaid = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    const splitId = Number(req.params.id)
    const participantUserId = Number(req.params.participantId)
    if (!userId || isNaN(splitId) || isNaN(participantUserId))
      return res.status(400).json({ message: '參數錯誤' })
    if (userId !== participantUserId)
      return res.status(403).json({ message: '只能標記自己的付款狀態' })

    const result = await prisma.$transaction(async (tx) => {
      const participant = await tx.splitParticipant.findFirst({
        where: { splitId, userId: participantUserId },
        include: { split: true },
      })
      if (!participant) throw new Error('NOT_FOUND_PARTICIPANT')

      if (!participant.settled) {
        await tx.splitParticipant.updateMany({
          where: { splitId, userId: participantUserId },
          data: { settled: true },
        })
      }

      const remain = await tx.splitParticipant.count({
        where: { splitId, settled: false },
      })
      const allPaidNow = remain === 0

      if (allPaidNow) {
        const updatedSplit = await tx.split.update({
          where: { id: splitId },
          data: { settled: true },
          select: { id: true, description: true, paidById: true },
        })

        const all = await tx.splitParticipant.findMany({
          where: { splitId },
          select: { userId: true },
        })

        // ✅ 安全建立通知接收者清單（過濾 null）
        const receiverIds = new Set<number>()
        if (updatedSplit.paidById) receiverIds.add(updatedSplit.paidById)
        for (const a of all) receiverIds.add(a.userId)

        const message = `「${updatedSplit.description ?? '分帳'}」所有參與者已付款，自動結算完成`
        await tx.notification.createMany({
          data: Array.from(receiverIds).map((uid) => ({
            userId: uid,
            message,
            read: false,
          })),
        })
      }

      return { allPaidNow }
    })

    res.json({
      message: '付款狀態已更新',
      allPaid: result.allPaidNow,
      autoSettled: result.allPaidNow,
    })
  } catch (err: any) {
    if (err?.message === 'NOT_FOUND_PARTICIPANT') {
      return res.status(404).json({ message: '找不到參與者紀錄' })
    }
    console.error('更新付款狀態失敗:', err)
    res.status(500).json({ message: '更新失敗', error: err })
  }
}

/* =========================
   分帳統計（含外幣換算台幣總額）
========================= */
export const getSplitStats = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId
    const groupId = Number(req.query.group)
    if (!userId) return res.status(401).json({ message: '未登入' })

    const whereClause: any = {}
    if (groupId) whereClause.groupId = groupId

    const unsettledSplits = await prisma.split.findMany({
      where: { ...whereClause, settled: false },
      include: {
        participants: { where: { userId } },
        paidBy: true,
        group: true,
      },
    })

    const stats = {
      totalUnsettled: unsettledSplits.length,
      totalAmount: 0,
      paidByMe: 0,
      owedToMe: 0,
      myDebts: 0,
    }

    unsettledSplits.forEach((split) => {
      const myParticipation = split.participants[0]
      if (myParticipation) {
        if (split.paidById === userId) {
          stats.paidByMe += split.amount
          stats.totalAmount += split.amount
        } else {
          stats.myDebts += myParticipation.amount
          stats.totalAmount += myParticipation.amount
        }
      }
    })
    stats.owedToMe = stats.paidByMe - stats.myDebts

    res.json(stats)
  } catch (err) {
    console.error('取得分帳統計失敗:', err)
    res.status(500).json({ message: '查詢失敗', error: err })
  }
}
