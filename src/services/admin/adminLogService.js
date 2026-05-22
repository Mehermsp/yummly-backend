import { query } from "../../config/db.js";

// ==============================
// ADMIN LOGS
// ==============================

export const getLogs = async (limit = 50) => {
    return await query(
        `
        SELECT 
            l.id,
            l.admin_id,
            l.action,
            l.entity_type,
            l.entity_id,
            l.details,
            l.created_at,
            u.name AS admin_name

        FROM admin_activity_log l

        LEFT JOIN users u
            ON l.admin_id = u.id

        ORDER BY l.created_at DESC

        LIMIT ?
        `,
        [parseInt(limit)]
    );
};

export default {
    getLogs,
};
