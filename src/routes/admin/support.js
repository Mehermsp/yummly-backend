import { Router } from "express";

import {
    getTicket,
    listTickets,
    replyToTicket,
    updateTicket,
} from "../../controllers/admin/adminSupportController.js";

const router = Router();

router.get("/", listTickets);
router.get("/:ticketId", getTicket);
router.patch("/:ticketId", updateTicket);
router.post("/:ticketId/messages", replyToTicket);

export default router;
