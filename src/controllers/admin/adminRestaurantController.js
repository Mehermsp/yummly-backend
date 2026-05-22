import * as adminRestaurantService from "../../services/admin/adminRestaurantService.js";

// ==============================
// APPLICATIONS
// ==============================

export const getApplications = async (req, res) => {
    try {
        const applications = await adminRestaurantService.getApplications(
            req.query.limit
        );

        res.json(applications);
    } catch (error) {
        console.error("Error fetching applications:", error);

        res.status(500).json({
            error: "Failed to fetch applications",
            details: error.message,
        });
    }
};

export const getApplicationById = async (req, res) => {
    try {
        const application = await adminRestaurantService.getApplicationById(
            req.params.id
        );

        if (!application) {
            return res.status(404).json({
                error: "Application not found",
            });
        }

        res.json(application);
    } catch (error) {
        console.error("Error fetching application:", error);

        res.status(500).json({
            error: "Failed to fetch application",
        });
    }
};

export const approveApplication = async (req, res) => {
    try {
        const result = await adminRestaurantService.approveApplication({
            applicationId: req.params.id,
            reviewedBy: req.user?.id || null,
        });

        res.json(result);
    } catch (error) {
        console.error("Error approving application:", error);

        res.status(500).json({
            error: "Failed to approve application",
        });
    }
};

export const rejectApplication = async (req, res) => {
    try {
        const result = await adminRestaurantService.rejectApplication({
            applicationId: req.params.id,
            rejectionReason: req.body.rejection_reason,
            reviewedBy: req.user?.id || null,
        });

        res.json(result);
    } catch (error) {
        console.error("Error rejecting application:", error);

        res.status(500).json({
            error: "Failed to reject application",
        });
    }
};

// ==============================
// RESTAURANTS
// ==============================

export const getRestaurants = async (req, res) => {
    try {
        const restaurants = await adminRestaurantService.getRestaurants();

        res.json(restaurants);
    } catch (error) {
        console.error("Error fetching restaurants:", error);

        res.status(500).json({
            error: "Failed to fetch restaurants",
            details: error.message,
        });
    }
};

export const getRestaurantById = async (req, res) => {
    try {
        const restaurant = await adminRestaurantService.getRestaurantById(
            req.params.id
        );

        if (!restaurant) {
            return res.status(404).json({
                error: "Restaurant not found",
            });
        }

        res.json(restaurant);
    } catch (error) {
        console.error("Error fetching restaurant:", error);

        res.status(500).json({
            error: "Failed to fetch restaurant",
        });
    }
};

export const updateRestaurantStatus = async (req, res) => {
    try {
        const result = await adminRestaurantService.updateRestaurantStatus(
            req.params.id,
            req.body.status
        );

        res.json(result);
    } catch (error) {
        console.error("Error updating restaurant status:", error);

        res.status(500).json({
            error: "Failed to update restaurant status",
        });
    }
};

export const updateRestaurant = async (req, res) => {
    try {
        const result = await adminRestaurantService.updateRestaurant(
            req.params.id,
            req.body
        );

        res.json(result);
    } catch (error) {
        console.error("Error updating restaurant:", error);

        res.status(500).json({
            error: "Failed to update restaurant",
        });
    }
};

// ==============================
// MENU
// ==============================

export const getRestaurantMenu = async (req, res) => {
    try {
        const items = await adminRestaurantService.getRestaurantMenu(
            req.params.id
        );

        res.json(items);
    } catch (error) {
        console.error("Error fetching restaurant menu:", error);

        res.status(500).json({
            error: "Failed to fetch restaurant menu",
        });
    }
};

// ==============================
// ANALYTICS
// ==============================

export const getRestaurantAnalytics = async (req, res) => {
    try {
        const { restaurant_id } = req.query;

        if (!restaurant_id) {
            return res.status(400).json({
                error: "restaurant_id is required",
            });
        }

        const analytics = await adminRestaurantService.getRestaurantAnalytics(
            restaurant_id
        );

        res.json(analytics);
    } catch (error) {
        console.error("Error fetching restaurant analytics:", error);

        res.status(500).json({
            error: "Failed to fetch restaurant analytics",
        });
    }
};

export default {
    getApplications,
    getApplicationById,
    approveApplication,
    rejectApplication,
    getRestaurants,
    getRestaurantById,
    updateRestaurantStatus,
    updateRestaurant,
    getRestaurantMenu,
    getRestaurantAnalytics,
};
