import { Router } from "express";

const router = Router();

router.get("/", (req, res) => {
    res.status(200).json({
        success: true,
        message: "Payment routes are available",
    });
});

export default router;
