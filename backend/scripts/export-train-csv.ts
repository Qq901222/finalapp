/// <reference types="node" />
import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

const prisma = new PrismaClient()

const KEEP = new Set(['餐飲','交通','娛樂','日用品','醫療','教育','旅遊','其他'])
const ROOT = path.resolve(process.cwd(), 'training')
const DATA = path.join(ROOT, 'data')
const TRAIN = path.join(DATA, 'train.csv')
const VALID = path.join(DATA, 'valid.csv')
const LABELS = path.join(ROOT, 'labels.json')

function clean(s: string) {
  const n = (s || '').normalize('NFKC')
  const x = n
    .replace(/\s+/g, ' ')
    .replace(/[^0-9A-Za-z\u3400-\u9FFF\u3000-\u303F\s+.,\/-]/g, '')
    .trim()
  return x
}

async function main() {
  fs.mkdirSync(DATA, { recursive: true })

  const rows = await prisma.record.findMany({
    select: { note: true, category: true }
  })

  const samples: { text: string; label: string }[] = []
  for (const r of rows) {
    const text = clean(String(r.note ?? ''))
    const label = String(r.category ?? '').trim()
    if (!text || text.length < 2) continue
    if (!KEEP.has(label)) continue
    if (/^\d+([.,]\d+)?$/.test(text)) continue
    samples.push({ text, label })
  }

  if (samples.length < 200) {
    console.error('samples too few:', samples.length)
    process.exit(2)
  }

  const labelSet = Array.from(new Set(samples.map(s => s.label))).sort()
  const labelMap: Record<string, number> = {}
  labelSet.forEach((l, i) => (labelMap[l] = i))
  fs.writeFileSync(LABELS, JSON.stringify(labelMap, null, 2), 'utf-8')

  const byLabel: Record<string, { text: string; label: string }[]> = {}
  for (const s of samples) (byLabel[s.label] ||= []).push(s)

  const train: string[] = ['text,label']
  const valid: string[] = ['text,label']
  for (const l of Object.keys(byLabel)) {
    const arr = byLabel[l]
    arr.sort(() => Math.random() - 0.5)
    const nValid = Math.max(1, Math.round(arr.length * 0.1))
    const v = arr.slice(0, nValid)
    const t = arr.slice(nValid)
    for (const s of t) train.push(`"${s.text.replace(/"/g, '""')}",${l}`)
    for (const s of v) valid.push(`"${s.text.replace(/"/g, '""')}",${l}`)
  }

  fs.writeFileSync(TRAIN, train.join('\n'), 'utf-8')
  fs.writeFileSync(VALID, valid.join('\n'), 'utf-8')
  console.log('done', { TRAIN, VALID, LABELS, total: samples.length })
}

main().finally(() => prisma.$disconnect())
