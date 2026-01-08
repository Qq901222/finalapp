import { Request, Response } from 'express';
import fs from 'fs';
import speech from '@google-cloud/speech';
import { toLinear16Mono16k } from '../utils/ffmpeg';
import { parseSpokenExpense } from '../utils/spokenParser';
import { hybridClassify } from '../utils/aiFilter';
import { createRecordNotification } from './notificationController';

let speechClient: InstanceType<typeof speech.SpeechClient> | null = null;

function getSpeechClient() {
  if (speechClient) return speechClient;

  const raw = process.env.GOOGLE_VISION_KEY;
  if (!raw) {
    throw new Error('GOOGLE_VISION_KEY is missing');
  }

  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch {
    throw new Error('GOOGLE_VISION_KEY is not valid JSON');
  }

  speechClient = new speech.SpeechClient({ credentials });
  return speechClient;
}

type SttAlternative = {
  transcript?: string;
  confidence?: number;
};

// 共用：把上傳檔轉成文字
async function transcribeAudioInternal(file: Express.Multer.File): Promise<{
  text: string;
  confidence: number;
  alternatives: string[];
}> {
  const converted = await toLinear16Mono16k(file.path);

  const audioBytes = fs.readFileSync(converted).toString('base64');
  const client = getSpeechClient();

  const [response] = await client.recognize({
    audio: { content: audioBytes },
    config: {
      encoding: 'LINEAR16',
      languageCode: 'zh-TW',
      sampleRateHertz: 16000,
      enableAutomaticPunctuation: true,
      enableWordConfidence: true,
      model: 'default',
      useEnhanced: true,
    },
  });

  safeUnlink(file.path);
  safeUnlink(converted);

  const results = response.results ?? [];

  const text = results
    .map((r) => r.alternatives?.[0]?.transcript ?? '')
    .join(' ')
    .trim();

  const confs = results
    .map((r) => r.alternatives?.[0]?.confidence)
    .filter((c): c is number => typeof c === 'number');

  const avgConfidence = confs.length
    ? confs.reduce((a, b) => a + b, 0) / confs.length
    : 0;

  const alternatives = results
    .map((r) => (r.alternatives ?? []) as SttAlternative[])
    .map((alts) => alts.slice(1).map((a) => a.transcript?.trim()))
    .flat()
    .filter((t): t is string => !!t)
    .slice(0, 3);

  return { text, confidence: avgConfidence, alternatives };
}

function safeUnlink(p?: string) {
  if (!p) return;
  try {
    fs.unlinkSync(p);
  } catch {}
}

// ===== /api/stt =====
export async function transcribeAudio(req: Request, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: '未登入' });

    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ message: '缺少上傳檔案 field: file' });

    const { text, confidence: sttConfidence, alternatives } =
      await transcribeAudioInternal(file);

    if (!text) {
      return res.status(400).json({
        message: '無法識別語音內容',
        suggestions: ['請確保語音清晰', '請在安靜環境下錄製'],
      });
    }

    const parsedResult = parseSpokenExpense(text);

    let finalCategory = parsedResult.category;
    let categorySource = 'local';

    if (!finalCategory && parsedResult.note) {
      try {
        const aiResult = await hybridClassify(parsedResult.note, userId);
        finalCategory = aiResult.category;
        categorySource = aiResult.source;
      } catch {
        finalCategory = '其他';
        categorySource = 'error';
      }
    }

    const overallConfidence = Math.round(
      (sttConfidence + parsedResult.confidence) / 2
    );

    if (parsedResult.amount && parsedResult.note) {
      try {
        await createRecordNotification(userId, {
          amount: parsedResult.amount,
          note: parsedResult.note,
          category: finalCategory || '其他',
        });
      } catch {}
    }

    return res.json({
      text,
      amount: parsedResult.amount,
      note: parsedResult.note,
      category: finalCategory,
      account: parsedResult.account,
      confidence: overallConfidence,
      sttConfidence: Math.round(sttConfidence * 100),
      parseConfidence: parsedResult.confidence,
      categorySource,
      alternatives,
      suggestions: parsedResult.suggestions,
    });
  } catch (err: any) {
    console.error('[STT error]', err?.message || err);
    return res.status(500).json({
      message: '語音轉文字失敗',
      error: err?.message,
    });
  }
}

// ===== 純文字 STT（不用音檔）=====
export async function sttFromText(req: Request, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: '未登入' });

    const textRaw = String(req.body?.text ?? '').trim();
    if (!textRaw) {
      return res.status(400).json({ message: 'text 必填' });
    }

    const parsedResult = parseSpokenExpense(textRaw);

    let finalCategory = parsedResult.category;
    let categorySource = 'local';

    if (!finalCategory && parsedResult.note) {
      try {
        const aiResult = await hybridClassify(parsedResult.note, userId);
        finalCategory = aiResult.category;
        categorySource = aiResult.source;
      } catch {
        finalCategory = '其他';
        categorySource = 'error';
      }
    }

    return res.json({
      text: textRaw,
      amount: parsedResult.amount,
      note: parsedResult.note,
      category: finalCategory,
      account: parsedResult.account,
      confidence: parsedResult.confidence,
      categorySource,
      suggestions: parsedResult.suggestions,
    });
  } catch (err: any) {
    return res.status(500).json({
      message: '解析失敗',
      error: err?.message || String(err),
    });
  }
}

// ===== 快速語音記帳 =====
export async function quickVoiceRecord(req: Request, res: Response) {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: '未登入' });

    const { text, accountId, groupId } = req.body;
    if (!text || !accountId) {
      return res.status(400).json({ message: '缺少必要欄位 text 或 accountId' });
    }

    const parsedResult = parseSpokenExpense(text);
    if (!parsedResult.amount || !parsedResult.note) {
      return res.status(400).json({
        message: '無法解析記帳內容',
        suggestions: parsedResult.suggestions,
      });
    }

    let finalCategory = parsedResult.category;
    if (!finalCategory) {
      try {
        const aiResult = await hybridClassify(parsedResult.note, userId);
        finalCategory = aiResult.category;
      } catch {
        finalCategory = '其他';
      }
    }

    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();

    const record = await prisma.record.create({
      data: {
        amount: parsedResult.amount,
        note: parsedResult.note,
        category: finalCategory,
        quantity: 1,
        accountId: Number(accountId),
        groupId: groupId ? Number(groupId) : null,
        paymentMethod: parsedResult.account || '現金',
        userId,
      },
    });

    return res.status(201).json({
      message: '語音記帳建立成功',
      record,
    });
  } catch (err: any) {
    return res.status(500).json({
      message: '語音記帳建立失敗',
      error: err?.message || String(err),
    });
  }
}
