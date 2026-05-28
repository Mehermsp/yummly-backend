import { Router } from "express";
import {
    generateSettlements,
    listBankAccounts,
    listSettlements,
    updateSettlement,
    verifyBankAccount,
} from "../../controllers/admin/adminFinanceController.js";

const router = Router();

router.get("/bank-accounts", listBankAccounts);
router.patch("/bank-accounts/:bankAccountId/verification", verifyBankAccount);
router.get("/settlements", listSettlements);
router.post("/settlements/generate", generateSettlements);
router.patch("/settlements/:settlementId", updateSettlement);

export default router;
