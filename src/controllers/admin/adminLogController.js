import * as adminLogService from "../../services/admin/adminLogService.js";

// ==============================
// ADMIN LOGS
// ==============================

export const getLogs = async (req, res) => {
    try {
        const logs = await adminLogService.getLogs(req.query.limit);

        res.json(logs);
    } catch (error) {
        console.error("Error fetching logs:", error);

        res.status(500).json({
            error: "Failed to fetch logs",
        });
    }
};

export default {
    getLogs,
};
