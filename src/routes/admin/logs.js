import { Router } from "express";

import { getLogs } from "../../controllers/admin/adminLogController.js";

const router = Router();

router.get("/", getLogs);

export default router;
