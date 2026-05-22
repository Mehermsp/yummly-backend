import * as adminDashboardService from "../../services/admin/adminDashboardService.js";

// Get Statistics
export const getStatistics = async (req, res) => {
    try {
        const statistics = await adminDashboardService.getDashboardStatistics();

        res.json(statistics);
    } catch (error) {
        console.error("Error fetching statistics:", error);

        res.status(500).json({
            error: "Failed to fetch statistics",
        });
    }
};

// Get Overview
export const getOverview = async (req, res) => {
    try {
        const overview = await adminDashboardService.getDashboardStatistics();

        res.json(overview);
    } catch (error) {
        console.error("Error fetching overview:", error);

        res.status(500).json({
            error: "Failed to fetch overview",
        });
    }
};

export default {getStatistics, getOverview}