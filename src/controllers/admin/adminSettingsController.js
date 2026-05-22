import * as adminSettingsService from "../../services/admin/adminSettingsService.js";

// ==============================
// GENERAL SETTINGS
// ==============================

export const getGeneralSettings = async (req, res) => {
    try {
        const settings = await adminSettingsService.getGeneralSettings();

        res.json(settings);
    } catch (error) {
        console.error("Error fetching general settings:", error);

        res.status(500).json({
            error: "Failed to fetch general settings",
        });
    }
};

export const updateGeneralSettings = async (req, res) => {
    try {
        const result = await adminSettingsService.updateGeneralSettings(
            req.body
        );

        res.json(result);
    } catch (error) {
        console.error("Error updating general settings:", error);

        res.status(500).json({
            error: "Failed to update general settings",
        });
    }
};

// ==============================
// NOTIFICATION SETTINGS
// ==============================

export const getNotificationSettings = async (req, res) => {
    try {
        const settings = await adminSettingsService.getNotificationSettings();

        res.json(settings);
    } catch (error) {
        console.error("Error fetching notification settings:", error);

        res.status(500).json({
            error: "Failed to fetch notification settings",
        });
    }
};

export const updateNotificationSettings = async (req, res) => {
    try {
        const result = await adminSettingsService.updateNotificationSettings(
            req.body
        );

        res.json(result);
    } catch (error) {
        console.error("Error updating notification settings:", error);

        res.status(500).json({
            error: "Failed to update notification settings",
        });
    }
};

// ==============================
// SECURITY SETTINGS
// ==============================

export const getSecuritySettings = async (req, res) => {
    try {
        const settings = await adminSettingsService.getSecuritySettings();

        res.json(settings);
    } catch (error) {
        console.error("Error fetching security settings:", error);

        res.status(500).json({
            error: "Failed to fetch security settings",
        });
    }
};

export const updateSecuritySettings = async (req, res) => {
    try {
        const result = await adminSettingsService.updateSecuritySettings(
            req.body
        );

        res.json(result);
    } catch (error) {
        console.error("Error updating security settings:", error);

        res.status(500).json({
            error: "Failed to update security settings",
        });
    }
};

// ==============================
// COMMISSION SETTINGS
// ==============================

export const getRestaurantCommission = async (req, res) => {
    try {
        const settings = await adminSettingsService.getRestaurantCommission();

        res.json(settings);
    } catch (error) {
        console.error("Error fetching commission settings:", error);

        res.status(500).json({
            error: "Failed to fetch commission settings",
        });
    }
};

export const updateRestaurantCommission = async (req, res) => {
    try {
        const result = await adminSettingsService.updateRestaurantCommission(
            req.body
        );

        res.json(result);
    } catch (error) {
        console.error("Error updating commission settings:", error);

        res.status(500).json({
            error: "Failed to update commission settings",
        });
    }
};

// ==============================
// DELIVERY SETTINGS
// ==============================

export const getDeliverySettings = async (req, res) => {
    try {
        const settings = await adminSettingsService.getDeliverySettings();

        res.json(settings);
    } catch (error) {
        console.error("Error fetching delivery settings:", error);

        res.status(500).json({
            error: "Failed to fetch delivery settings",
        });
    }
};

export const updateDeliverySettings = async (req, res) => {
    try {
        const result = await adminSettingsService.updateDeliverySettings(
            req.body
        );

        res.json(result);
    } catch (error) {
        console.error("Error updating delivery settings:", error);

        res.status(500).json({
            error: "Failed to update delivery settings",
        });
    }
};

export default {
    getGeneralSettings,
    updateGeneralSettings,
    getNotificationSettings,
    updateNotificationSettings,
    getSecuritySettings,
    updateSecuritySettings,
    getRestaurantCommission,
    updateRestaurantCommission,
    getDeliverySettings,
    updateDeliverySettings,
};
