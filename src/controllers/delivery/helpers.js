export const ASSIGNMENT_RESPONSE_WINDOW_MS = 5 * 60 * 1000;

export const normalizeDeliveryStatusInput = (value) => {
    const normalized = String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_");

    const aliases = {
        accepted: "accepted",

        picked_up: "picked_up",

        out_for_delivery: "picked_up",

        on_the_way: "picked_up",

        delivered: "delivered",

        out: "picked_up",
    };

    return aliases[normalized] || normalized;
};

export const isAcceptanceWindowOpen = (assignedAt) => {
    if (!assignedAt) return false;

    return (
        Date.now() - new Date(assignedAt).getTime() <=
        ASSIGNMENT_RESPONSE_WINDOW_MS
    );
};
