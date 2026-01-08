// scripts/exportRecordsToCSV.ts
import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'
import { Parser } from 'json2csv'

const prisma = new PrismaClient()

async function main() {
  console.log('Exporting Records from DB...')

  const records = await prisma.record.findMany({
    select: { id: true, note: true, category: true, amount: true }
  })

  if (records.length === 0) {
    console.log('No records found.')
    return
  }

  const fields = ['id', 'note', 'category', 'amount']
  const parser = new Parser({ fields })
  const csv = parser.parse(records)

  const filePath = path.join(process.cwd(), 'export_records.csv')
  fs.writeFileSync(filePath, csv, 'utf8')

  console.log(`Export completed. ${records.length} records written to: ${filePath}`)
}

main()
  .catch(e => {
    console.error('Error exporting records:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
