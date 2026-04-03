require("dotenv").config({ path: "./.env" });
const path = require("path");
const { spawn } = require("child_process");

const migrationPath = path.join(__dirname, "add_restaurants.js");

const child = spawn("node", [migrationPath], {
    cwd: __dirname,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production" },
});

child.on("close", (code) => {
    console.log(`Migration exited with code ${code}`);
    process.exit(code);
});
