// src/routes/split.ts
import express, { Request } from 'express';
import { 
  createSplit, 
  getSplits, 
  settleSplit, 
  markParticipantPaid,
  getSplitStats 
} from '../controllers/splitController';
import authMiddleware from '../middlewares/authMiddleware';
import { requireMemberByGroup, requireMemberBySplitParam } from '../middlewares/groupGuard';

const router = express.Router();

/* =========================
   建立分帳
   - 需登入
   - 驗證 body.groupId 屬於呼叫者所在群組
========================= */
router.post(
  '/',
  authMiddleware,
  requireMemberByGroup((req: Request) => {
    const gid = Number((req.body as any)?.groupId);
    return Number.isFinite(gid) && gid > 0 ? gid : null;
  }),
  createSplit
);

/* =========================
   查詢群組分帳紀錄
   - 需登入
   - 支援 query.group 或 query.groupId
   - 驗證呼叫者確實為群組成員
========================= */
router.get(
  '/',
  authMiddleware,
  requireMemberByGroup((req: Request) => {
    const q = req.query as any;
    const gid = Number(q?.group || q?.groupId);
    return Number.isFinite(gid) && gid > 0 ? gid : null;
  }),
  getSplits
);

/* =========================
   取得分帳統計
   - 需登入
   - 可不帶 group，查詢全部未結清分帳
========================= */
router.get('/stats', authMiddleware, getSplitStats);

/* =========================
   結算分帳（付款者操作）
   - 需登入
   - 驗證使用者為該分帳所在群組成員
========================= */
router.patch(
  '/:id/settle',
  authMiddleware,
  requireMemberBySplitParam,
  settleSplit
);

/* =========================
   標記參與者付款狀態
   - 需登入
   - 驗證使用者為該分帳所在群組成員
========================= */
router.patch(
  '/:id/participants/:participantId/pay',
  authMiddleware,
  requireMemberBySplitParam,
  markParticipantPaid
);

export default router;
