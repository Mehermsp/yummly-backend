// Redis cache utility for get/set with error fallback
const redis = require("./redisClient");

async function getCache(key) {
    try {
        const value = await redis.get(key);
        return value ? JSON.parse(value) : null;
    } catch (err) {
        // Redis error, treat as cache miss
        return null;
    }
}

async function setCache(key, value, ttl = 300) {
    try {
        await redis.set(key, JSON.stringify(value), "EX", ttl);
    } catch (err) {
        // Ignore Redis errors
    }
}

module.exports = { getCache, setCache };
