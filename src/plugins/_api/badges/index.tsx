/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./fixDiscordBadgePadding.css";

import { _getBadges, BadgePosition, BadgeUserArgs, ProfileBadge } from "@api/Badges";
import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import { Heart } from "@components/Heart";
import DonateButton from "@components/settings/DonateButton";
import { openContributorModal } from "@components/settings/tabs";
import { Devs } from "@utils/constants";
import { copyWithToast } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { Margins } from "@utils/margins";
import { shouldShowContributorBadge } from "@utils/misc";
import { closeModal, ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { ContextMenuApi, Forms, Menu, Toasts, UserStore } from "@webpack/common";

const CONTRIBUTOR_BADGE = "https://cdn.discordapp.com/emojis/1092089799109775453.png?size=64";
const BADGES_API_URL = "https://badges.vencord.dev/badges.json";
const CACHE_KEY = "vencord_donor_badges_cache";
const CACHE_TIMESTAMP_KEY = "vencord_donor_badges_cache_ts";
const STATS_KEY = "vencord_badge_stats";
const FETCH_TIMEOUT = 10000;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 3000, 8000];
const REFRESH_INTERVAL = 1000 * 60 * 30;

interface DonorBadge {
    tooltip: string;
    badge: string;
}

interface BadgeStats {
    totalViews: number;
    badgeClicks: Record<string, number>;
    lastFetch: number;
    fetchSuccess: boolean;
}

const ContributorBadge: ProfileBadge = {
    id: "vencord_contributor_badge",
    description: "Vencord Contributor",
    iconSrc: CONTRIBUTOR_BADGE,
    position: BadgePosition.START,
    shouldShow: ({ userId }) => shouldShowContributorBadge(userId),
    onClick: (_, { userId }) => openContributorModal(UserStore.getUser(userId))
};

let DonorBadges = {} as Record<string, DonorBadge[]>;
let intervalId: NodeJS.Timeout;
const logger = new Logger("BadgeAPI");

function getCache(): { data: Record<string, DonorBadge[]> | null; timestamp: number } {
    try {
        const cached = localStorage.getItem(CACHE_KEY);
        const timestamp = parseInt(localStorage.getItem(CACHE_TIMESTAMP_KEY) ?? "0", 10);
        return {
            data: cached ? JSON.parse(cached) : null,
            timestamp
        };
    } catch {
        return { data: null, timestamp: 0 };
    }
}

function setCache(data: Record<string, DonorBadge[]>) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(data));
        localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
    } catch (e) {
        logger.warn("Failed to cache badges:", e);
    }
}

function getStats(): BadgeStats {
    try {
        const stats = localStorage.getItem(STATS_KEY);
        return stats ? JSON.parse(stats) : {
            totalViews: 0,
            badgeClicks: {},
            lastFetch: 0,
            fetchSuccess: false
        };
    } catch {
        return { totalViews: 0, badgeClicks: {}, lastFetch: 0, fetchSuccess: false };
    }
}

function updateStats(updates: Partial<BadgeStats>) {
    try {
        const stats = { ...getStats(), ...updates };
        localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    } catch { }
}

async function fetchWithTimeout(url: string, timeout: number): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            cache: "no-store"
        });
        clearTimeout(timeoutId);
        return response;
    } catch (e) {
        clearTimeout(timeoutId);
        throw e;
    }
}

async function fetchBadgesWithRetry(noCache = false, retryCount = 0): Promise<Record<string, DonorBadge[]>> {
    try {
        const response = await fetchWithTimeout(BADGES_API_URL, FETCH_TIMEOUT);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        updateStats({ lastFetch: Date.now(), fetchSuccess: true });
        return data;
    } catch (e) {
        logger.warn(`Fetch failed (attempt ${retryCount + 1}/${MAX_RETRIES}):`, e);

        if (retryCount < MAX_RETRIES - 1) {
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[retryCount]));
            return fetchBadgesWithRetry(noCache, retryCount + 1);
        }

        const cached = getCache();
        if (cached.data && cached.timestamp > 0) {
            logger.warn("Using cached badges after all retries failed");
            updateStats({ fetchSuccess: false });
            return cached.data;
        }

        throw e;
    }
}

async function loadBadges(noCache = false) {
    if (noCache) {
        logger.info("Force refreshing badges...");
    }

    try {
        const data = await fetchBadgesWithRetry(noCache);
        DonorBadges = data;
        setCache(data);
        logger.info(`Loaded badges for ${Object.keys(data).length} users`);
    } catch (e) {
        logger.error("Failed to load badges after all retries:", e);
        const cached = getCache();
        if (cached.data) {
            DonorBadges = cached.data;
            logger.info("Using cached badges due to fetch failure");
        }
    }
}

function BadgeContextMenu({ badge }: { badge: Omit<ProfileBadge, "id"> & BadgeUserArgs; }) {
    return (
        <Menu.Menu
            navId="vc-badge-context"
            onClose={ContextMenuApi.closeContextMenu}
            aria-label="Badge Options"
        >
            {badge.description && (
                <Menu.MenuItem
                    id="vc-badge-copy-name"
                    label="Copy Badge Name"
                    action={() => {
                        copyWithToast(badge.description!);
                        const stats = getStats();
                        stats.badgeClicks[badge.description!] = (stats.badgeClicks[badge.description!] || 0) + 1;
                        updateStats({ badgeClicks: stats.badgeClicks });
                    }}
                />
            )}
            {badge.iconSrc && (
                <Menu.MenuItem
                    id="vc-badge-copy-link"
                    label="Copy Badge Image Link"
                    action={() => copyWithToast(badge.iconSrc!)}
                />
            )}
        </Menu.Menu>
    );
}

function getBadgeCounts(): { total: number; users: number } {
    let total = 0;
    const users = Object.keys(DonorBadges).length;
    for (const badges of Object.values(DonorBadges)) {
        total += badges.length;
    }
    return { total, users };
}

export default definePlugin({
    name: "BadgeAPI",
    description: "API to add badges to users",
    authors: [Devs.Megu, Devs.Ven, Devs.TheSun],
    required: true,
    patches: [
        {
            find: "#{intl::PROFILE_USER_BADGES}",
            replacement: [
                {
                    match: /alt:" ","aria-hidden":!0,src:.{0,80}(\i).iconSrc/,
                    replace: "...$1.props,$&"
                },
                {
                    match: /(?<=forceOpen:.{0,60}?ariaHidden:!0,?)children:(?=.{0,80}?(\i)\.id)/,
                    replace: "children:$1.component?$self.renderBadgeComponent({...$1}) :"
                },
                {
                    match: /href:(\i)\.link/,
                    replace: "...$self.getBadgeMouseEventHandlers($1),$&"
                }
            ]
        },
        {
            find: "getLegacyUsername(){",
            replacement: {
                match: /getBadges\(\)\{[\s\S]{0,200}?return\[/,
                replace: "$&...$self.getBadges(this),"
            }
        }
    ],

    get DonorBadges() {
        return DonorBadges;
    },

    toolboxActions: {
        async "Refetch Badges"() {
            await loadBadges(true);
            const { total, users } = getBadgeCounts();
            Toasts.show({
                id: Toasts.genId(),
                message: `Refetched badges! (${users} users, ${total} badges)`,
                type: Toasts.Type.SUCCESS
            });
        },
        "Show Badge Stats"() {
            const stats = getStats();
            const { total, users } = getBadgeCounts();
            const topBadges = Object.entries(stats.badgeClicks)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5);

            console.table({
                "Total Badge Views": stats.totalViews,
                "Users with Badges": users,
                "Total Badges": total,
                "Last Fetch": stats.lastFetch ? new Date(stats.lastFetch).toLocaleString() : "Never",
                "Fetch Success": stats.fetchSuccess ? "Yes" : "No",
                "Top Clicked Badges": topBadges.map(([name, count]) => `${name}: ${count}`).join(", ") || "None"
            });

            Toasts.show({
                id: Toasts.genId(),
                message: "Badge stats logged to console!",
                type: Toasts.Type.SUCCESS
            });
        },
        "Clear Badge Cache"() {
            localStorage.removeItem(CACHE_KEY);
            localStorage.removeItem(CACHE_TIMESTAMP_KEY);
            Toasts.show({
                id: Toasts.genId(),
                message: "Badge cache cleared!",
                type: Toasts.Type.SUCCESS
            });
        }
    },

    userProfileBadge: ContributorBadge,

    async start() {
        const cached = getCache();
        if (cached.data) {
            DonorBadges = cached.data;
            logger.info(`Loaded ${Object.keys(cached.data).length} users from cache`);
        }

        await loadBadges();

        clearInterval(intervalId);
        intervalId = setInterval(loadBadges, REFRESH_INTERVAL);
    },

    async stop() {
        clearInterval(intervalId);
    },

    getBadges(profile: any) {
        let userId: string | undefined;
        let guildId: string | undefined;

        if (profile) {
            userId = profile.userId ?? profile.props?.userId;
            guildId = profile.guildId ?? profile.props?.guildId;

            if (!userId && typeof profile === "object") {
                for (const key of Object.keys(profile)) {
                    if (key.toLowerCase().includes("user") && !userId) {
                        const val = profile[key];
                        if (typeof val === "string" && val !== "unknown" && !val.includes(" ")) {
                            userId = val;
                        } else if (val && typeof val === "object" && val.id) {
                            userId = val.id;
                        }
                    }
                }
            }
        }

        if (!userId) return [];

        const stats = getStats();
        stats.totalViews++;
        updateStats({ totalViews: stats.totalViews });

        try {
            return _getBadges({ userId, guildId: guildId ?? "" });
        } catch (e) {
            logger.error(e);
            return [];
        }
    },

    renderBadgeComponent: ErrorBoundary.wrap((badge: ProfileBadge & BadgeUserArgs) => {
        const Component = badge.component!;
        return <Component {...badge} />;
    }, { noop: true }),

    getBadgeMouseEventHandlers(badge: ProfileBadge & BadgeUserArgs) {
        const handlers = {} as Record<string, (e: React.MouseEvent) => void>;

        if (!badge) return handlers;

        const { onClick, onContextMenu } = badge;

        if (onClick) handlers.onClick = e => onClick(e, badge);
        if (onContextMenu) handlers.onContextMenu = e => onContextMenu(e, badge);

        return handlers;
    },

    getDonorBadges(userId: string) {
        return DonorBadges[userId]?.map((badge, idx) => ({
            id: `vencord_donor_badge_${idx}`,
            iconSrc: badge.badge,
            description: badge.tooltip,
            position: BadgePosition.START,
            props: {
                style: {
                    borderRadius: "50%",
                    transform: "scale(0.9)"
                }
            } as ProfileBadge["props"] & { loading?: "lazy" | "eager"; decoding?: "async" | "sync"; },
            onContextMenu(event, props) {
                ContextMenuApi.openContextMenu(event, () => <BadgeContextMenu badge={props} />);
            },
            onClick() {
                const modalKey = openModal(props => (
                    <ErrorBoundary noop onError={() => {
                        closeModal(modalKey);
                        VencordNative.native.openExternal("https://github.com/sponsors/Vendicated");
                    }}>
                        <ModalRoot {...props}>
                            <ModalHeader>
                                <Forms.FormTitle
                                    tag="h2"
                                    style={{
                                        width: "100%",
                                        textAlign: "center",
                                        margin: 0
                                    }}
                                >
                                    <Flex justifyContent="center" alignItems="center" gap="0.5em">
                                        <Heart />
                                        Vencord Donor
                                    </Flex>
                                </Forms.FormTitle>
                            </ModalHeader>
                            <ModalContent>
                                <Flex>
                                    <img
                                        role="presentation"
                                        src="https://cdn.discordapp.com/emojis/1026533070955872337.png"
                                        alt=""
                                        style={{ margin: "auto" }}
                                        loading="lazy"
                                    />
                                    <img
                                        role="presentation"
                                        src="https://cdn.discordapp.com/emojis/1026533090627174460.png"
                                        alt=""
                                        style={{ margin: "auto" }}
                                        loading="lazy"
                                    />
                                </Flex>
                                <div style={{ padding: "1em" }}>
                                    <Forms.FormText>
                                        This Badge is a special perk for Vencord Donors
                                    </Forms.FormText>
                                    <Forms.FormText className={Margins.top20}>
                                        Please consider supporting the development of Vencord by becoming a donor. It would mean a lot!!
                                    </Forms.FormText>
                                </div>
                            </ModalContent>
                            <ModalFooter>
                                <Flex justifyContent="center" style={{ width: "100%" }}>
                                    <DonateButton />
                                </Flex>
                            </ModalFooter>
                        </ModalRoot>
                    </ErrorBoundary>
                ));
            },
        } satisfies ProfileBadge));
    }
});
