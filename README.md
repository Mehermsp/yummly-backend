Server setup (Node + MySQL)

1. Install dependencies

    npm install

2. Create MySQL database

    - Ensure MySQL server is running.
    - Run the SQL in `schema.sql`:

        mysql -u root -p < schema.sql

3. Configure environment

    - Set DB credentials in `server/.env`.
    - Start the API with:

        npm start

API endpoints

-   `GET /ping` health check
-   `POST /auth/register` register new user
-   `POST /auth/login` login user
-   `GET /menu` get all menu items
-   `POST /orders` create order
-   `GET /orders/:id` get order details
-   `POST /cart` save or update cart
-   `GET /cart/:userId` get cart
-   `POST /wishlist` save or update wishlist
-   `GET /wishlist/:userId` get wishlist
-   `GET /user/:userId` get user profile
-   `POST /user/:userId/profile` update user profile
-   `GET /user/:userId/orders` get user orders

Database

-   Uses MySQL with connection pooling
-   Cart and wishlist data are persisted per user
-   Foreign key constraints keep menu and user relations consistent
