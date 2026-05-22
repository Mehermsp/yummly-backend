import * as adminUserService from "../../services/admin/adminUserService.js";

// ==============================
// USERS
// ==============================

export const getUsers = async (req, res) => {
    try {
        const users = await adminUserService.getUsers({
            role: req.query.role,
            search: req.query.search,
            status: req.query.status,
        });

        res.json(users);
    } catch (error) {
        console.error("Error fetching users:", error);

        res.status(500).json({
            error: "Failed to fetch users",
        });
    }
};

export const getUserById = async (req, res) => {
    try {
        const user = await adminUserService.getUserById(req.params.id);

        if (!user) {
            return res.status(404).json({
                error: "User not found",
            });
        }

        res.json(user);
    } catch (error) {
        console.error("Error fetching user:", error);

        res.status(500).json({
            error: "Failed to fetch user",
        });
    }
};

export const updateUserStatus = async (req, res) => {
    try {
        const result = await adminUserService.updateUserStatus(
            req.params.id,
            req.body.is_active
        );

        res.json(result);
    } catch (error) {
        console.error("Error updating user status:", error);

        res.status(500).json({
            error: "Failed to update user status",
        });
    }
};

export const updateUserRole = async (req, res) => {
    try {
        const result = await adminUserService.updateUserRole(
            req.params.id,
            req.body.role
        );

        res.json(result);
    } catch (error) {
        console.error("Error updating user role:", error);

        res.status(500).json({
            error: "Failed to update user role",
        });
    }
};

export const deleteUser = async (req, res) => {
    try {
        const result = await adminUserService.deleteUser(req.params.id);

        res.json(result);
    } catch (error) {
        console.error("Error deleting user:", error);

        res.status(500).json({
            error: "Failed to delete user",
        });
    }
};

// ==============================
// DELIVERY PARTNERS
// ==============================

export const getDeliveryPartners = async (req, res) => {
    try {
        const partners = await adminUserService.getDeliveryPartners();

        res.json(partners);
    } catch (error) {
        console.error("Error fetching delivery partners:", error);

        res.status(500).json({
            error: "Failed to fetch delivery partners",
        });
    }
};

export const getDeliveryPartnerById = async (req, res) => {
    try {
        const partner = await adminUserService.getDeliveryPartnerById(
            req.params.id
        );

        if (!partner) {
            return res.status(404).json({
                error: "Delivery partner not found",
            });
        }

        res.json(partner);
    } catch (error) {
        console.error("Error fetching delivery partner:", error);

        res.status(500).json({
            error: "Failed to fetch delivery partner",
        });
    }
};

export const updateDeliveryPartnerStatus = async (req, res) => {
    try {
        const result = await adminUserService.updateDeliveryPartnerStatus(
            req.params.id,
            req.body.is_available
        );

        res.json(result);
    } catch (error) {
        console.error("Error updating delivery partner status:", error);

        res.status(500).json({
            error: "Failed to update delivery partner status",
        });
    }
};

export const getDeliveryPartnerAnalytics = async (req, res) => {
    try {
        const analytics = await adminUserService.getDeliveryPartnerAnalytics();

        res.json(analytics);
    } catch (error) {
        console.error("Error fetching delivery analytics:", error);

        res.status(500).json({
            error: "Failed to fetch delivery analytics",
        });
    }
};

export default {
    getUsers,
    getUserById,
    updateUserStatus,
    updateUserRole,
    deleteUser,
    getDeliveryPartners,
    getDeliveryPartnerById,
    updateDeliveryPartnerStatus,
    getDeliveryPartnerAnalytics,
};
