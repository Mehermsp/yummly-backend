import * as adminDeliveryService from "../../services/admin/adminDeliveryService.js";

// Get Delivery Partners
export const getDeliveryPartners = async (req, res) => {
    try {
        const partners = await adminDeliveryService.getDeliveryPartners(
            req.query.showAll === "true"
        );

        res.json(partners);
    } catch (error) {
        console.error("Error fetching delivery partners:", error);

        res.status(500).json({
            error: "Failed to fetch delivery partners",
        });
    }
};

// Get Delivery Partner By ID
export const getDeliveryPartnerById = async (req, res) => {
    try {
        const partner = await adminDeliveryService.getDeliveryPartnerById(
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

// Update Delivery Partner Status
export const updateDeliveryPartnerStatus = async (req, res) => {
    try {
        const result = await adminDeliveryService.updateDeliveryPartnerStatus(
            req.params.id,
            req.body.status
        );

        res.json(result);
    } catch (error) {
        console.error("Error updating delivery partner status:", error);

        res.status(500).json({
            error: error.message || "Failed to update delivery partner status",
        });
    }
};

// Update Delivery Partner
export const updateDeliveryPartner = async (req, res) => {
    try {
        const result = await adminDeliveryService.updateDeliveryPartner(
            req.params.id,
            req.body
        );

        res.json(result);
    } catch (error) {
        console.error("Error updating delivery partner:", error);

        res.status(500).json({
            error: "Failed to update delivery partner",
        });
    }
};

// Delivery Partner Analytics
export const getDeliveryPartnerAnalytics = async (req, res) => {
    try {
        const { delivery_partner_id } = req.query;

        if (!delivery_partner_id) {
            return res.status(400).json({
                error: "delivery_partner_id is required",
            });
        }

        const analytics =
            await adminDeliveryService.getDeliveryPartnerAnalytics(
                delivery_partner_id
            );

        res.json(analytics);
    } catch (error) {
        console.error("Error fetching delivery analytics:", error);

        res.status(500).json({
            error: "Failed to fetch delivery partner analytics",
        });
    }
};

export default {
    getDeliveryPartnerAnalytics,
    getDeliveryPartners,
    getDeliveryPartnerById,
    updateDeliveryPartnerStatus,
    updateDeliveryPartner
}