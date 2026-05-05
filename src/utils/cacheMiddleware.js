// Generic Redis cache middleware for Express
const { getCache, setCache } = require("./redisCache");

/**
 * cacheMiddleware - Express middleware for Redis caching
 * @param {function} keyBuilder - function(req) => string (cache key)
 * @param {number} ttl - cache time-to-live in seconds
 */
function cacheMiddleware(keyBuilder, ttl = 300) {
    return async (req, res, next) => {
        const key = keyBuilder(req);
        if (!key) return next();
        const cached = await getCache(key);
        if (cached) {
            return res.json({ ...cached, _cache: true });
        }
        // Monkey-patch res.json to cache the response
        const originalJson = res.json.bind(res);
        res.json = (body) => {
            setCache(key, body, ttl);
            return originalJson(body);
        };
        next();
    };
}

module.exports = cacheMiddleware;
