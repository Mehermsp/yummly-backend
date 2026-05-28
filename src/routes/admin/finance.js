import { Router } from "express";
import {
    applyBonus,
    applyPenalty,
    createRefundTransaction,
    getFinancialDashboard,
    generateSettlements,
    listDeliveryEarnings,
    listBankAccounts,
    listOrderFinancials,
    listRestaurantSettlements,
    listSettlements,
    updateRestaurantSettlement,
    updateSettlement,
    verifyBankAccount,
} from "../../controllers/admin/adminFinanceController.js";

const router = Router();

router.get("/dashboard", getFinancialDashboard);
router.get("/order-financials", listOrderFinancials);
router.get("/restaurant-settlements", listRestaurantSettlements);
router.patch(
    "/restaurant-settlements/:settlementId",
    updateRestaurantSettlement
);
router.get("/delivery-earnings", listDeliveryEarnings);
router.post("/penalties", applyPenalty);
router.post("/bonuses", applyBonus);
router.post("/refund-transactions", createRefundTransaction);
router.get("/bank-accounts", listBankAccounts);
router.patch("/bank-accounts/:bankAccountId/verification", verifyBankAccount);
router.get("/settlements", listSettlements);
router.post("/settlements/generate", generateSettlements);
router.patch("/settlements/:settlementId", updateSettlement);

export default router;
