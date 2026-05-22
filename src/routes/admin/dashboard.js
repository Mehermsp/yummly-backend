import { Router } from "express";

import {
    getStatistics,
    getOverview,
} from "../../controllers/admin/adminDashboardController.js";

const router = Router();

router.get("/statistics", getStatistics);
router.get("/overview", getOverview);

export default router;
