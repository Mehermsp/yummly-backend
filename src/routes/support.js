import { Router } from "express";

import {
    createTicket,
    getMyTicket,
    listMyRefunds,
    listMyTickets,
    replyToMyTicket,
} from "../controllers/supportController.js";
import { ROLES } from "../constants/index.js";
import { authenticate } from "../middleware/authenticate.js";
import { authorize } from "../middleware/authorize.js";

const router = Router();

router.use(authenticate);

router.get(
    "/tickets",
    authorize(ROLES.CUSTOMER, ROLES.RESTAURANT_PARTNER, ROLES.DELIVERY_PARTNER),
    listMyTickets
);
router.post(
    "/tickets",
    authorize(ROLES.CUSTOMER, ROLES.RESTAURANT_PARTNER, ROLES.DELIVERY_PARTNER),
    createTicket
);
router.get(
    "/tickets/:ticketId",
    authorize(ROLES.CUSTOMER, ROLES.RESTAURANT_PARTNER, ROLES.DELIVERY_PARTNER),
    getMyTicket
);
router.post(
    "/tickets/:ticketId/messages",
    authorize(ROLES.CUSTOMER, ROLES.RESTAURANT_PARTNER, ROLES.DELIVERY_PARTNER),
    replyToMyTicket
);
router.get("/refunds", authorize(ROLES.CUSTOMER), listMyRefunds);

export default router;
