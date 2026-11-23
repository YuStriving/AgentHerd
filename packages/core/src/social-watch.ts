// Notices on the owner's 小红书 and 知乎 accounts (ADR 0058). The host signs in and reads. Since ADR
// 0100 a mailbox source of kind `social` does the looking, rarely and at uneven times: every look
// is a browser visit with the owner's account, and a platform that thinks it sees a robot may
// limit or close the account.

export type SocialPlatform = "xiaohongshu" | "zhihu";
export type SocialKind = "mentions" | "likes" | "follows";

export const SOCIAL_PLATFORMS: readonly SocialPlatform[] = ["xiaohongshu", "zhihu"];
/**
 * The kinds AgentHerd tells the owner about: comments, answers and @ only. Likes, saves and new
 * followers are never told (the owner, 2026-11-11: 「告诉我赞和收藏，还有谁关注根本没意义」);
 * agents can still list them through the platform's tools.
 */
export const SOCIAL_KINDS: readonly SocialKind[] = ["mentions"];

/** Minutes between looks, and how far each look may move either way (so they do not tick). */
export const SOCIAL_POLL_MINUTES = 20;

/** What a new platform watches until the owner changes it (ADR 0058). */
export const DEFAULT_SOCIAL_WATCH: Readonly<Record<SocialKind, boolean>> = {
  mentions: true,
  likes: false,
  follows: false,
};

/** One notice on the owner's account. Everything but `id` and `kind` is someone else's text. */
export interface SocialNotice {
  id: string;
  kind: SocialKind;
  /** Who did it. */
  who: string;
  /** What they wrote, for comments, answers and @; empty for likes and follows. */
  text: string;
  /** The post or question it is on. */
  on?: string;
  url?: string;
}

/** One platform as the host gives it to the watch. */
export interface SocialSource {
  platform: SocialPlatform;
  /** 小红书 / 知乎 */
  name: string;
  /** Turned on and signed in. */
  ready(): boolean;
  /** Unread notices by kind, without marking them read. */
  unread(): Promise<Partial<Record<SocialKind, number>>>;
  /** The latest notices of a kind; reading them may mark them read on the platform. */
  notices(kind: SocialKind): Promise<SocialNotice[]>;
}
