import { Router } from "express";
import {
    getNotifications,
    readAllNotifications,
    readNotification,
} from "../controllers/notificationController.js";
import { authenticate } from "../middleware/authenticate.js";

const router = Router();

router.use(authenticate);
router.get("/", getNotifications);
router.patch("/:notificationId/read", readNotification);
router.post("/read-all", readAllNotifications);

export default router;
