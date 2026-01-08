import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // 建立測試用使用者
  const user = await prisma.user.upsert({
    where: { email: 'test@example.com' },
    update: {},
    create: {
      name: '測試用戶',
      email: 'test@example.com',
      password: 'hashedpassword',
      isVerified: true,
    },
  })

  // 建立預設帳戶（現金 / 銀行 / 信用卡）
  await prisma.account.createMany({
    data: [
      {
        name: '錢包現金',
        kind: 'cash',
        balance: 5000,
        userId: user.id,
      },
      {
        name: '台新銀行帳戶',
        kind: 'bank',
        balance: 12000,
        userId: user.id,
      },
      {
        name: '玉山信用卡',
        kind: 'credit',
        balance: -8000,
        limitAmount: 30000,
        userId: user.id,
      },
    ],
  })

  // 建立測試群組
  const group = await prisma.groupModel.create({
    data: {
      name: '測試群組',
      joinCode: 'ABC123',
      members: {
        create: {
          userId: user.id,
          role: 'admin',
        },
      },
    },
  })

  // 建立記帳紀錄
  await prisma.record.createMany({
    data: [
      {
        amount: 120,
        note: '早餐',
        category: '餐飲',
        paymentMethod: 'cash',
        userId: user.id,
        accountId: 1,
        groupId: group.id,
      },
      {
        amount: 350,
        note: '午餐聚餐',
        category: '餐飲',
        paymentMethod: 'bank',
        userId: user.id,
        accountId: 2,
        groupId: group.id,
      },
    ],
  })

  console.log('✅ Seeding complete!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
