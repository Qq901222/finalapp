// src/controllers/receiptController.ts
import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { getVisionClient } from '../services/visionClient';
import { parseReceiptText } from '../services/parse-receipt';
import { ParsedReceipt } from '../types/receipt';

// Google Vision OCR
async function extractTextFromImage(filePath: string): Promise<string> {
  const client = getVisionClient();
  const [result] = await client.textDetection(filePath);
  const detections = result.textAnnotations;
  return detections && detections.length > 0 ? detections[0].description || '' : '';
}

export const parseReceiptController = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '未上傳檔案' });
    }

    const imagePath = path.resolve(req.file.path);
    const rawText = await extractTextFromImage(imagePath);

    const userId = req.user?.userId;
    const parsedReceipt: ParsedReceipt = await parseReceiptText(rawText, userId);

    return res.json({
      success: true,
      data: {
        items: parsedReceipt.items,
        totalAmount: parsedReceipt.totalAmount,
        storeName: parsedReceipt.storeName,
        date: parsedReceipt.date,
        filteredCount: parsedReceipt.filteredCount,
        totalCount: parsedReceipt.totalCount,
        rawText,
      },
    });
  } catch (error: any) {
    console.error('收據解析錯誤:', error);
    res.status(500).json({
      success: false,
      message: '伺服器錯誤',
      error: error.message,
    });
  } finally {
    if (req.file) fs.unlink(req.file.path, () => {});
  }
};

// 只解析前端傳來的純文字（不經 OCR）
export const parseReceiptTextController = async (req: Request, res: Response) => {
  try {
    const { text } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({
        success: false,
        message: '請提供有效的文字內容',
      });
    }

    const userId = req.user?.userId;
    const parsedReceipt: ParsedReceipt = await parseReceiptText(text, userId);

    return res.json({
      success: true,
      data: {
        items: parsedReceipt.items,
        totalAmount: parsedReceipt.totalAmount,
        storeName: parsedReceipt.storeName,
        date: parsedReceipt.date,
        filteredCount: parsedReceipt.filteredCount,
        totalCount: parsedReceipt.totalCount,
      },
    });
  } catch (error: any) {
    console.error('文字解析錯誤:', error);
    res.status(500).json({
      success: false,
      message: '伺服器錯誤',
      error: error.message,
    });
  }
};
