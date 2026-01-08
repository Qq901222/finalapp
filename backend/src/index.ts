// src/index.ts
import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import cron from 'node-cron';
import { exec } from 'child_process';
import exchangeRoute from './routes/exchange';
import authMiddleware from './middlewares/authMiddleware';
// Routes
import authRoutes from './routes/auth';
import accountRoutes from './routes/account';
import recordRoutes from './routes/record';
import groupRoutes from './routes/group';
import splitRoutes from './routes/split';
import notificationRoutes from './routes/notification';
import classifierRoutes from './routes/classifier';
import statsRoutes from './routes/stats';
import unclassifiedRoutes from './routes/unclassified';
import userRoutes from './routes/user';
import receiptRoutes from './routes/receipt';
import ocrRoutes from './routes/ocr';
import sttRoutes from './routes/stt';
import healthRoutes from './routes/health';
import overviewRoutes from './routes/overview';
import { errorHandler } from './utils/errorHandler';
import jobsRouter from './routes/jobs';
import { scheduleWeeklyRepayReminder } from './jobs/weeklyRepayReminder';
import devRouter from './routes/dev';


dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3001);

/* =========================
   Middlewares
========================= */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Railway / Load Balancer 健康檢查（一定要有）
app.get('/', (_req, res) => {
  res.status(200).send('OK');
});


// 靜態檔（若有上傳圖片）
app.use('/uploads', express.static('uploads'));

// 可選：Auth 偵錯（設 AUTH_DEBUG=1 才輸出）
app.use('/api/auth', (req, _res, next) => {
  if (process.env.AUTH_DEBUG === '1') {
    console.log('[AUTH DEBUG] content-type:', req.headers['content-type']);
    console.log('[AUTH DEBUG] body:', req.body);
  }
  next();
});

// ✅ 請求日誌（除噪：只記錄 /api 路徑）
app.use('/api', (req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.originalUrl}`);
  next();
});

// ✅ 重要：全域守門員（除了 /api/auth 與 /api/health，其餘 /api/* 一律驗證並注入 req.user）
app.use('/api', (req, res, next) => {
  if (
    req.path.startsWith('/auth') ||
    req.path.startsWith('/health') ||
    req.path.startsWith('/exchange') // ← 加這行
  ) {
    return next();
  }
  return authMiddleware(req as any, res as any, next);
});

app.use('/api/exchange', exchangeRoute);
console.log('[Route] /api/exchange mounted');



/* =========================
   Routes
========================= */
app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/records', recordRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/splits', splitRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/classifier', classifierRoutes);
app.use('/api/unclassified', unclassifiedRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/users', userRoutes);
app.use('/api/receipts', receiptRoutes);
app.use('/api/ocr', ocrRoutes);
app.use('/api/stt', sttRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/overview', overviewRoutes);
app.use('/api/group', groupRoutes);
app.use('/api/dev', jobsRouter);
app.use('/api/dev', devRouter);
app.use('/ocr', ocrRoutes);


/* =========================
   Cron Jobs
========================= */
cron.schedule('0 0 1 * *', () => {
  exec('ts-node scripts/monthlySplitJob.ts', (err, stdout) => {
    if (err) console.error('月結排程錯誤:', err);
    else console.log('月結排程執行完成：', stdout);
  });
});

if (process.env.SKIP_JOBS !== '1') {
  scheduleWeeklyRepayReminder();
}
/* =========================
   Global Error Handler
========================= */
app.use(errorHandler);

/* =========================
   Start Server (only once)
========================= */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

/* =========================
   Type Augmentation
========================= */
declare global {
  namespace Express {
    interface Request {
      user?: { userId: number };
      file?: Express.Multer.File;
      files?: Express.Multer.File[] | { [fieldname: string]: Express.Multer.File[] };
    }
  }
}
export {};
