// prisma/seedRecords.ts
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('DB =', process.env.DATABASE_URL ? 'loaded' : 'missing')

  const email = 'seed@example.com'
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      name: 'Seed User',
      email,
      password: bcrypt.hashSync('password123', 10),
      isVerified: true
    }
  })
  console.log('user id =', user.id)

  let group = await (prisma as any).groupModel.findFirst({ where: { name: 'Demo Group' } })
  if (!group) group = await (prisma as any).groupModel.create({ data: { name: 'Demo Group' } })
  console.log('group id =', group.id)

  const member = await prisma.groupMember.findFirst({
    where: { groupId: group.id, userId: user.id }
  })
  if (!member) {
    await prisma.groupMember.create({
      data: { groupId: group.id, userId: user.id, role: 'admin' }
    })
  }

const invoiceRecords = [
  { note: '蝦皮 購物', amount: 299, category: '其他' },
  { note: 'PChome 訂單', amount: 799, category: '其他' },
  { note: 'momo 訂單', amount: 680, category: '其他' },
  { note: '郵局 郵資', amount: 28, category: '其他' },
  { note: '宅配 運費', amount: 120, category: '其他' },
  { note: '禮物 包裝材料', amount: 60, category: '其他' },
  { note: '露天拍賣 費用', amount: 450, category: '其他' },
  { note: '百貨公司 禮券', amount: 1000, category: '其他' }
]

  const result = await prisma.record.createMany({
    data: invoiceRecords.map(r => ({
      userId: user.id,
      groupId: group.id,
      amount: r.amount,
      note: r.note,
      category: r.category
    }))
  })

  console.log(`已成功寫入 ${result.count} 筆 Record 資料`)
}

main()
  .catch(e => {
    console.error('error', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
