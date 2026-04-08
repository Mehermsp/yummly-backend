const multer = require("multer");
const { uploadImage } = require("../utils/cloudinary.js");

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 4 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (file?.mimetype?.startsWith("image/")) {
            return cb(null, true);
        }
        cb(new Error("Only image files are allowed"));
    },
});
function registerRestaurantRoutes(app, { getPool }) {
    const requireRestaurantPartner = require("../middleware/isRestaurantPartner")(
        getPool
    );
    const getRestaurant = require("../middleware/getRestaurant")(getPool);

    // Get current restaurant profile
    app.get(
        "/restaurant/profile",
        requireRestaurantPartner,
        getRestaurant,
        async (req, res) => {
            try {
                res.json(req.restaurant);
            } catch (err) {
                console.error("Get profile error:", err);
                res.status(500).json({ error: "Failed to fetch profile" });
            }
        }
    );

    // Update restaurant profile
    app.put(
        "/restaurant/profile",
        requireRestaurantPartner,
        getRestaurant,
        async (req, res) => {
            try {
                const restaurantId = req.restaurant.id;
                const {
                    name,
                    description,
                    logo,
                    cover_image,
                    city,
                    area,
                    address,
                    pincode,
                    landmark,
                    cuisines,
                    open_time,
                    close_time,
                    days_open,
                } = req.body;

                const updates = [];
                const params = [];

                const allowedFields = [
                    "name",
                    "description",
                    "logo",
                    "cover_image",
                    "city",
                    "area",
                    "address",
                    "pincode",
                    "landmark",
                    "cuisines",
                    "open_time",
                    "close_time",
                    "days_open",
                ];

                for (const field of allowedFields) {
                    if (req.body[field] !== undefined) {
                        updates.push(`${field} = ?`);
                        let value = req.body[field];

                        // Handle JSON fields
                        if (field === "cuisines" || field === "days_open") {
                            value = JSON.stringify(value);
                        }
                        params.push(value);
                    }
                }

                if (updates.length === 0) {
                    return res
                        .status(400)
                        .json({ error: "No fields to update" });
                }

                params.push(restaurantId);

                await getPool().query(
                    `UPDATE restaurants SET ${updates.join(", ")} WHERE id = ?`,
                    params
                );

                const [updated] = await getPool().query(
                    "SELECT * FROM restaurants WHERE id = ?",
                    [restaurantId]
                );

                res.json(updated[0]);
            } catch (err) {
                console.error("Update profile error:", err);
                res.status(500).json({ error: "Failed to update profile" });
            }
        }
    );

    // Get restaurant stats for dashboard
    app.get(
        "/restaurant/stats",
        requireRestaurantPartner,
        getRestaurant,
        async (req, res) => {
            try {
                const restaurantId = req.restaurant.id;

                // Get today's orders count and revenue
                const [todayStats] = await getPool().query(
                    `
                SELECT 
                    COUNT(*) as total_orders,
                    COALESCE(SUM(total), 0) as total_revenue
                FROM orders 
                WHERE restaurant_id = ? 
                AND DATE(created_at) = CURDATE()
            `,
                    [restaurantId]
                );

                // Get pending orders
                const [pendingOrders] = await getPool().query(
                    `
                SELECT COUNT(*) as pending 
                FROM orders 
                WHERE restaurant_id = ? 
                AND status IN ('placed', 'confirmed', 'preparing')
            `,
                    [restaurantId]
                );

                // Get total menu items
                const [menuCount] = await getPool().query(
                    `
                SELECT COUNT(*) as count 
                FROM menu_items 
                WHERE restaurant_id = ?
            `,
                    [restaurantId]
                );

                // Get rating
                const [ratingData] = await getPool().query(
                    `
                SELECT rating, total_orders 
                FROM restaurants 
                WHERE id = ?
            `,
                    [restaurantId]
                );

                res.json({
                    todayOrders: todayStats[0].total_orders || 0,
                    todayRevenue: todayStats[0].total_revenue || 0,
                    pendingOrders: pendingOrders[0].pending || 0,
                    totalMenuItems: menuCount[0].count || 0,
                    rating: ratingData[0]?.rating || 0,
                    totalOrders: ratingData[0]?.total_orders || 0,
                });
            } catch (err) {
                console.error("Stats error:", err);
                res.status(500).json({ error: "Failed to fetch stats" });
            }
        }
    );

    // Toggle restaurant active status
    app.put(
        "/restaurant/status",
        requireRestaurantPartner,
        getRestaurant,
        async (req, res) => {
            try {
                const restaurantId = req.restaurant.id;
                const { is_active } = req.body;

                await getPool().query(
                    "UPDATE restaurants SET is_active = ? WHERE id = ?",
                    [is_active ? 1 : 0, restaurantId]
                );

                res.json({ success: true, is_active: is_active });
            } catch (err) {
                console.error("Status toggle error:", err);
                res.status(500).json({ error: "Failed to update status" });
            }
        }
    );
    app.get(
        "/restaurant/analytics",
        requireRestaurantPartner,
        getRestaurant,
        async (req, res) => {
        try {
            const restaurantId = req.restaurant.id;

            const [orders] = await getPool().query(
                `SELECT total, status, created_at 
       FROM orders 
       WHERE restaurant_id = ?`,
                [restaurantId]
            );

            // 📊 Revenue by day (last 7 days)
            const last7Days = {};
            const today = new Date();

            for (let i = 6; i >= 0; i--) {
                const d = new Date();
                d.setDate(today.getDate() - i);
                const key = d.toISOString().split("T")[0];
                last7Days[key] = { revenue: 0, orders: 0 };
            }

            orders.forEach((o) => {
                const createdAt = new Date(o.created_at);
                if (Number.isNaN(createdAt.getTime())) return;
                const date = createdAt.toISOString().split("T")[0];
                if (last7Days[date]) {
                    last7Days[date].revenue += Number(o.total || 0);
                    last7Days[date].orders += 1;
                }
            });

            const weekRevenue = Object.keys(last7Days).map((date) => ({
                day: new Date(date).toLocaleDateString("en-IN", {
                    weekday: "short",
                }),
                revenue: last7Days[date].revenue,
                orders: last7Days[date].orders,
            }));

            // 📊 Hourly orders
            const hourly = {};
            for (let i = 0; i < 24; i++) hourly[i] = 0;

            orders.forEach((o) => {
                const hour = new Date(o.created_at).getHours();
                hourly[hour]++;
            });

            const hourlyOrders = Object.keys(hourly).map((h) => ({
                hour: `${h}:00`,
                orders: hourly[h],
            }));

            res.json({
                weekRevenue,
                hourlyOrders,
                totalOrders: orders.length,
                totalRevenue: orders.reduce(
                    (sum, order) => sum + Number(order.total || 0),
                    0
                ),
            });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: "Analytics failed" });
        }
        }
    );

    app.post(
        "/upload/logo",
        requireRestaurantPartner,
        getRestaurant,
        upload.single("logo"),
        async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ error: "No file uploaded" });
            }

            const restaurantId = req.restaurant?.id || req.body.restaurantId;
            const result = await uploadImage(
                req.file.buffer,
                "restaurant_logo",
                `${restaurantId}_logo`
            );

            res.json({
                url: result.url,
                publicId: result.publicId,
                width: result.width,
                height: result.height,
            });
        } catch (err) {
            if (err?.code === "LIMIT_FILE_SIZE") {
                return res
                    .status(400)
                    .json({ error: "Logo must be smaller than 4MB" });
            }
            console.error(err);
            res.status(500).json({ error: "Logo upload error" });
        }
        }
    );

    app.post(
        "/upload/cover",
        requireRestaurantPartner,
        getRestaurant,
        upload.single("cover"),
        async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ error: "No file uploaded" });
            }

            const restaurantId = req.restaurant?.id || req.body.restaurantId;
            const result = await uploadImage(
                req.file.buffer,
                "restaurant_cover",
                `${restaurantId}_cover`
            );

            res.json({
                url: result.url,
                publicId: result.publicId,
                width: result.width,
                height: result.height,
            });
        } catch (err) {
            if (err?.code === "LIMIT_FILE_SIZE") {
                return res
                    .status(400)
                    .json({ error: "Cover image must be smaller than 4MB" });
            }
            console.error(err);
            res.status(500).json({ error: "Cover upload error" });
        }
        }
    );

}

module.exports = registerRestaurantRoutes;
