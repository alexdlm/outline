import {
  RateLimiterMemory,
  RateLimiterRedis,
  RateLimiterRes,
} from "rate-limiter-flexible";
import { toError } from "@shared/utils/error";
import { Minute } from "@shared/utils/time";
import Logger from "@server/logging/Logger";
import Redis from "@server/storage/redis";

/**
 * Limits outbound requests to Codecks. Codecks allows 40 requests per 5
 * seconds per IP address, which every team on this server shares, so the
 * limit is global and kept below that.
 */
export class CodecksLimiter {
  /** Requests allowed per window, across all processes. */
  public static readonly points = 30;

  /**
   * Searches allowed per window, a share of the points above so that people
   * searching cannot use up the requests that load card mentions.
   */
  public static readonly searchPoints = 12;

  /** The window in seconds. */
  public static readonly duration = 5;

  /** How long to back off after a 429 that has no usable retry-after header. */
  public static readonly defaultBackoff = 30;

  /** The longest backoff honoured from a retry-after header, in seconds. */
  public static readonly maxBackoff = 5 * Minute.seconds;

  /**
   * Consumes a point for one outbound request. A limiter store outage is
   * logged and lets the request through.
   *
   * @returns false when the limit is reached and the request must not be sent.
   */
  public static async consume(): Promise<boolean> {
    return CodecksLimiter.consumeFrom(CodecksLimiter.rateLimiter);
  }

  /**
   * Consumes a point for one search, which then also consumes a point for its
   * request. A limiter store outage is logged and lets the search through.
   *
   * @returns false when searches are limited and this one must not be sent.
   */
  public static async consumeSearch(): Promise<boolean> {
    return CodecksLimiter.consumeFrom(CodecksLimiter.searchRateLimiter);
  }

  /**
   * Whether requests for an account are paused after Codecks rate limited it.
   *
   * @param accountId the Codecks account ID.
   * @returns true if requests must fail without being sent.
   */
  public static async isBackingOff(accountId: string): Promise<boolean> {
    try {
      const count = await Redis.defaultClient.exists(
        CodecksLimiter.backoffKey(accountId)
      );
      return count > 0;
    } catch (err) {
      Logger.error("Could not read Codecks backoff", toError(err));
      return false;
    }
  }

  /**
   * Pauses requests for an account after Codecks answered with a 429.
   *
   * @param accountId the Codecks account ID.
   * @param retryAfter the retry-after header of the response, if any.
   */
  public static async backoff(
    accountId: string,
    retryAfter?: string | null
  ): Promise<void> {
    try {
      await Redis.defaultClient.set(
        CodecksLimiter.backoffKey(accountId),
        "1",
        "EX",
        CodecksLimiter.parseRetryAfter(retryAfter)
      );
    } catch (err) {
      Logger.error("Could not store Codecks backoff", toError(err));
    }
  }

  /**
   * Resumes requests for an account.
   *
   * @param accountId the Codecks account ID.
   */
  public static async clearBackoff(accountId: string): Promise<void> {
    try {
      await Redis.defaultClient.del(CodecksLimiter.backoffKey(accountId));
    } catch (err) {
      Logger.error("Could not clear Codecks backoff", toError(err));
    }
  }

  /**
   * The Redis key that marks an account as backing off. It is outside the
   * team unfurl prefix, so clearing a team's unfurl cache does not lift it.
   *
   * @param accountId the Codecks account ID.
   * @returns the key.
   */
  public static backoffKey(accountId: string): string {
    return `codecks:backoff:${accountId}`;
  }

  /**
   * Converts a retry-after header to a backoff in whole seconds.
   *
   * @param retryAfter the header value, either seconds or an HTTP date.
   * @returns the backoff in seconds, at least one and at most maxBackoff.
   */
  public static parseRetryAfter(retryAfter?: string | null): number {
    const value = retryAfter?.trim();
    let seconds = CodecksLimiter.defaultBackoff;

    if (value && /^\d+$/.test(value)) {
      seconds = parseInt(value, 10);
    } else if (value) {
      const date = Date.parse(value);
      if (!Number.isNaN(date)) {
        seconds = Math.ceil((date - Date.now()) / 1000);
      }
    }

    return Math.min(Math.max(seconds, 1), CodecksLimiter.maxBackoff);
  }

  private static readonly globalKey = "global";

  private static limiter: RateLimiterRedis | undefined;

  private static searchLimiter: RateLimiterRedis | undefined;

  private static async consumeFrom(
    limiter: RateLimiterRedis
  ): Promise<boolean> {
    try {
      await limiter.consume(CodecksLimiter.globalKey);
      return true;
    } catch (err) {
      if (err instanceof RateLimiterRes) {
        return false;
      }
      Logger.error("Codecks rate limiter error", toError(err));
      return true;
    }
  }

  // Created on first use because the Redis client connects when accessed.
  private static get rateLimiter(): RateLimiterRedis {
    if (!CodecksLimiter.limiter) {
      CodecksLimiter.limiter = CodecksLimiter.createLimiter(
        "rl:codecks",
        CodecksLimiter.points
      );
    }
    return CodecksLimiter.limiter;
  }

  private static get searchRateLimiter(): RateLimiterRedis {
    if (!CodecksLimiter.searchLimiter) {
      CodecksLimiter.searchLimiter = CodecksLimiter.createLimiter(
        "rl:codecks-search",
        CodecksLimiter.searchPoints
      );
    }
    return CodecksLimiter.searchLimiter;
  }

  private static createLimiter(
    keyPrefix: string,
    points: number
  ): RateLimiterRedis {
    return new RateLimiterRedis({
      storeClient: Redis.defaultClient,
      keyPrefix,
      points,
      duration: CodecksLimiter.duration,
      insuranceLimiter: new RateLimiterMemory({
        points,
        duration: CodecksLimiter.duration,
      }),
    });
  }
}
