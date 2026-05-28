import { Router } from "express";

import {
    listRefunds,
    updateRefund,
} from "../../controllers/admin/adminSupportController.js";

const router = Router();

router.get("/", listRefunds);
router.patch("/:refundId", updateRefund);

export default router;
