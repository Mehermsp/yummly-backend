import Redis from "ioredis";
import { env } from "../config/env.js";

const createNoopRedis = () => ({
    on: () => {},
    get: async () => null,
    set: async () => "OK",
    del: async () => 0,
    quit: async () => "OK",
});

let redis = createNoopRedis();

if (env.redisEnabled) {
    redis = env.redisUrl
        ? new Redis(env.redisUrl)
        : new Redis({
              host: "127.0.0.1",
              port: 6379,
          });

    redis.on("error", (err) => {
        console.error("Redis error:", err.message);
    });
}


export default redis;
