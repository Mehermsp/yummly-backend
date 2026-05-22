import { query } from "../../config/db.js";
import * as adminOrderService from "../../services/admin/adminOrderService.js";

// Get Orders
export const getOrders = async (req, res) => {
    try {
        const orders = await adminOrderService.getOrders(req.query);

        res.json(orders);
    } catch (error) {
        console.error("Error fetching orders:", error);

        res.status(500).json({
            error: "Failed to fetch orders",
        });
    }
};

// Get Order by ID
export const getOrderById = async (req, res) => {
    try {
        const order = await adminOrderService.getOrderById(req.params.id);

        if (!order) {
            return res.status(404).json({
                error: "Order not found",
            });
        }

        res.json(order);
    } catch (error) {
        console.error("Error fetching order:", error);

        res.status(500).json({
            error: "Failed to fetch order",
        });
    }
};

// Update Order Status
export const updateOrderStatus = async (req, res) => {
    return res.status(403).json({
        error: "Admins cannot change order state directly.",
    });
};

// Assign Delivery Partner to Order
export const assignDeliveryPartner = async (req, res) => {
    try {
        const result = await adminOrderService.assignDeliveryPartner({
            orderId: req.params.id,
            deliveryPartnerId: req.body.delivery_partner_id,
            adminId: req.user.id,
        });

        res.json(result);
    } catch (error) {
        console.error("Error assigning delivery partner:", error);

        res.status(500).json({
            error: error.message || "Failed to assign delivery partner",
        });
    }
};

// Get Ready for Pickup Orders
export const getReadyForPickupOrders = async (req, res) => {
    try {
        const orders = await adminOrderService.getReadyForPickupOrders();

        res.json(orders);
    } catch (error) {
        console.error("Error fetching ready for pickup orders:", error);

        res.status(500).json({
            error: "Failed to fetch ready for pickup orders",
        });
    }
};

export default {
    getOrders,
    getOrderById,
    updateOrderStatus,
    assignDeliveryPartner,
    getReadyForPickupOrders,
};
