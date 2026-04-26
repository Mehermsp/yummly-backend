import { Router } from "express";
import { ROLES } from "../constants/index.js";
import { submitReview } from "../controllers/reviewController.js";
import { authenticate } from "../middleware/authenticate.js";
import { authorize } from "../middleware/authorize.js";

const router = Router();

router.use(authenticate, authorize(ROLES.CUSTOMER));
router.post("/", submitReview);

export default router;
