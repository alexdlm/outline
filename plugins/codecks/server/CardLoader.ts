import { toError } from "@shared/utils/error";
import { Minute, Second } from "@shared/utils/time";
import Logger from "@server/logging/Logger";
import { CacheHelper } from "@server/utils/CacheHelper";
import { RedisPrefixHelper } from "@server/utils/RedisPrefixHelper";
import type { CodecksCard } from "./codecks";

/** Where the cards of one team and Codecks account are loaded from. */
export interface CardSource {
  /** The Outline team. */
  teamId: string;
  /** The Codecks account the team is connected to. */
  accountId: string;
  /** Loads cards by number, resolving with those that were found. */
  load: (accountSeqs: number[]) => Promise<CodecksCard[]>;
}

/** A card, null when it does not exist, or undefined when it could not be loaded. */
export type CardResult = CodecksCard | null | undefined;

/**
 * Loads cards through a team level cache. Cards that are requested at about
 * the same time, such as the mentions of a document, are loaded together.
 * Access is not checked here, callers gate the cards they return.
 */
export class CardLoader {
  /** How long a card, or the fact that it does not exist, is cached in seconds. */
  public static readonly cacheExpiry = Minute.seconds;

  /** How long requests are collected before they are loaded together, in milliseconds. */
  public static readonly batchDelay = 15;

  /** The most cards loaded in one request. */
  public static readonly maxBatchSize = 100;

  /** The time allowed for loading a batch, which must stay below lockTimeout. */
  public static readonly requestTimeout = 3 * Second.ms;

  /** How long a card's cache lock is held while it loads, in milliseconds. */
  public static readonly lockTimeout = 4 * Second.ms;

  /**
   * Loads a card from the cache, or from the source when it is not cached.
   * Missing cards are cached as null, failed loads are not cached.
   *
   * @param source where the card is loaded from.
   * @param accountSeq the card's number within the organization.
   * @returns the card, null if it does not exist, or undefined if it could not be loaded.
   */
  public static async load(
    source: CardSource,
    accountSeq: number
  ): Promise<CardResult> {
    try {
      return await CacheHelper.getDataOrSet<CodecksCard | null>(
        CardLoader.cacheKey(source.teamId, source.accountId, accountSeq),
        () => CardLoader.enqueue(source, accountSeq),
        CardLoader.cacheExpiry,
        CardLoader.lockTimeout
      );
    } catch (err) {
      Logger.error("Failed to load Codecks card", toError(err));
      return undefined;
    }
  }

  /**
   * The cache key of a card. It is under the team's unfurl prefix, so that
   * clearing the team's unfurls clears it, and includes the account so that a
   * team connecting another organization never sees the previous one's cards.
   *
   * @param teamId the Outline team.
   * @param accountId the Codecks account.
   * @param accountSeq the card's number within the organization.
   * @returns the cache key.
   */
  public static cacheKey(
    teamId: string,
    accountId: string,
    accountSeq: number
  ): string {
    return `${RedisPrefixHelper.getUnfurlPrefix(teamId)}codecks:${accountId}:${accountSeq}`;
  }

  private static batches = new Map<string, Batch>();

  private static enqueue(
    source: CardSource,
    accountSeq: number
  ): Promise<CardResult> {
    const key = `${source.teamId}:${source.accountId}`;
    let batch = CardLoader.batches.get(key);
    if (!batch) {
      batch = {
        source,
        waiters: new Map(),
        timer: setTimeout(
          () => void CardLoader.flush(key),
          CardLoader.batchDelay
        ),
      };
      CardLoader.batches.set(key, batch);
    }

    const { waiters } = batch;
    return new Promise<CardResult>((resolve) => {
      const waiting = waiters.get(accountSeq);
      if (waiting) {
        waiting.push(resolve);
      } else {
        waiters.set(accountSeq, [resolve]);
      }

      if (waiters.size >= CardLoader.maxBatchSize) {
        void CardLoader.flush(key);
      }
    });
  }

  private static async flush(key: string): Promise<void> {
    const batch = CardLoader.batches.get(key);
    if (!batch) {
      return;
    }
    CardLoader.batches.delete(key);
    clearTimeout(batch.timer);

    const accountSeqs = [...batch.waiters.keys()];
    let found: Map<number, CodecksCard> | undefined;
    try {
      const cards = await batch.source.load(accountSeqs);
      found = new Map(cards.map((card) => [card.accountSeq, card]));
    } catch (err) {
      Logger.warn("Failed to load Codecks cards", {
        count: accountSeqs.length,
        error: toError(err).message,
      });
    }

    for (const [accountSeq, resolvers] of batch.waiters) {
      const card = found ? (found.get(accountSeq) ?? null) : undefined;
      resolvers.forEach((resolve) => resolve(card));
    }
  }
}

interface Batch {
  source: CardSource;
  waiters: Map<number, Array<(card: CardResult) => void>>;
  timer: ReturnType<typeof setTimeout>;
}
