const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, ".env") });

const {
    initDb,
    getPool,
    ensureAvailabilityColumn,
    ensureMealTypeColumn,
} = require("./config/db");
const { sendEmail, formatDeliveryPartnerHtml } = require("./services/email");
const createIsAdmin = require("./middleware/isAdmin");
const createRequireSelfOrAdmin = require("./middleware/requireSelfOrAdmin");
const registerSystemRoutes = require("./routes/system");
const registerAuthRoutes = require("./routes/auth");
const registerMenuRoutes = require("./routes/menu");
const registerOrderRoutes = require("./routes/orders");
const registerCartRoutes = require("./routes/cart");
const registerWishlistRoutes = require("./routes/wishlist");
const registerUserRoutes = require("./routes/users");
const registerAdminRoutes = require("./routes/admin");
const registerDeliveryRoutes = require("./routes/delivery");
const registerAddressRoutes = require("./routes/addresses");
const registerReviewRoutes = require("./routes/reviews");

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 8000;
const isAdmin = createIsAdmin(getPool);
const requireSelfOrAdmin = createRequireSelfOrAdmin(getPool);

const deps = {
    getPool,
    ensureAvailabilityColumn,
    ensureMealTypeColumn,
    sendEmail,
    formatDeliveryPartnerHtml,
    isAdmin,
    requireSelfOrAdmin,
};

registerSystemRoutes(app, deps);
registerAuthRoutes(app, deps);
registerMenuRoutes(app, deps);
registerOrderRoutes(app, deps);
registerCartRoutes(app, deps);
registerWishlistRoutes(app, deps);
registerUserRoutes(app, deps);
registerAdminRoutes(app, deps);
registerDeliveryRoutes(app, deps);
registerAddressRoutes(app, deps);
registerReviewRoutes(app, deps);

app.use("/uploads", express.static("uploads"));

async function start() {
    try {
        await initDb();
        app.listen(PORT, () => console.log("Server started on port", PORT));
    } catch (e) {
        console.error("Failed to start server", e.message);
        process.exit(1);
    }
}

start();
