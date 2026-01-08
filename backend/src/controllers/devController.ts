import { Request, Response, NextFunction } from 'express'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// ⚠️ 僅建議開發時使用
export async function purgeMyData(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.userId as number
    if (!userId) return res.status(401).json({ error: 'unauthorized' })

    await prisma.$transaction(async (tx) => {
      await tx.notification.deleteMany({ where: { userId } })
      await tx.unclassifiedNote.deleteMany({ where: { userId } })
      await tx.splitParticipant.deleteMany({ where: { userId } })
      await tx.record.deleteMany({ where: { userId } })
      await tx.account.deleteMany({ where: { userId } })
      await tx.groupMember.deleteMany({ where: { userId } })

      // 找出沒有成員的群組
      const emptyGroups = await tx.groupModel.findMany({
        where: { members: { none: {} } },
        select: { id: true },
      })
      const emptyIds = emptyGroups.map((g) => g.id)
      if (emptyIds.length) {
        await tx.split.deleteMany({ where: { groupId: { in: emptyIds } } })
        await tx.groupModel.deleteMany({ where: { id: { in: emptyIds } } })
      }
    })

    res.json({ ok: true })
  } catch (e) {
    console.error('[purgeMyData] error:', e)
    next(e)
  }
}
