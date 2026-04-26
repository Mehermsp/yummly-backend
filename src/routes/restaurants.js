import { Router } from "express";
import {
    getRestaurantDetails,
    getRestaurantMenuItems,
    listRestaurants,
} from "../controllers/restaurantsController.js";

const router = Router();

router.get("/", listRestaurants);
router.get("/:restaurantId", getRestaurantDetails);
router.get("/:restaurantId/menu", getRestaurantMenuItems);

export default router;
