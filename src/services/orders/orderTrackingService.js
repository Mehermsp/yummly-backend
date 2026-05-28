import { AppError } from "../../utils/http.js";

import { getOrderById, getOrderStatusLogs } from "../../models/orderModel.js";

export const getOrderTracking = async ({ orderId, customerId }) => {
    const order = await getOrderById(orderId);

    if (!order || Number(order.customer_id) !== Number(customerId)) {
        throw new AppError(404, "Order not found");
    }

    const logs = await getOrderStatusLogs(order.id);

    return {
        id: order.id,
        orderNumber: order.order_number,

        status: order.status,
        productStatus: order.product_status,

        deliveryPartnerName: order.delivery_partner_name,

        deliveryPartnerPhone: order.delivery_partner_phone,

        logs,
    };
};
