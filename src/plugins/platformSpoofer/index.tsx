/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { ErrorCard } from "@components/ErrorCard";
import { Margins } from "@utils/margins";
import definePlugin, { OptionType } from "@utils/types";
import { Forms, UserStore } from "@webpack/common";

const PLATFORM_INFO = {
  desktop: { browser: "Discord Client" },
  web: { browser: "Discord Web" },
  android: { browser: "Discord Android" },
  ios: { browser: "Discord iOS" },
  xbox: { browser: "Discord Embedded" },
  playstation: { browser: "Discord Embedded" },
  vr: { browser: "Discord VR" },
} as const;

type Platform = keyof typeof PLATFORM_INFO;

const settings = definePluginSettings({
  platform: {
    type: OptionType.SELECT,
    description: "What platform to show up as on",
    restartNeeded: true,
    default: "desktop" as Platform,
    options: [
      { label: "Desktop", value: "desktop", default: true },
      { label: "Web", value: "web" },
      { label: "Android", value: "android" },
      { label: "iOS", value: "ios" },
      { label: "Xbox", value: "xbox" },
      { label: "PlayStation", value: "playstation" },
      { label: "VR", value: "vr" },
    ],
  },
});

export default definePlugin({
  name: "PlatformSpoofer",
  description: "Spoof what platform or device you're on",
  authors: [{ name: "8xu", id: 793880467270008832n }],
  settings,

  settingsAboutComponent: () => (
    <ErrorCard className={Margins.bottom16}>
      <Forms.FormTitle tag="h2">Warning</Forms.FormTitle>
      <Forms.FormText>
        We can't guarantee this plugin won't get you warned or banned.
      </Forms.FormText>
    </ErrorCard>
  ),

  patches: [
    {
      find: "_doIdentify(){",
      replacement: [
        {
          match: /window._ws=null,null!=\i/,
          replace: "false"
        },
        {
          match: /(?<="GatewaySocket"\)\}\),properties:)(\i)/,
          replace: "{...$1,...$self.getPlatform(true)}"
        },
      ]
    },
  ],

  getPlatform(bypass: boolean, userId?: any) {
    if (bypass || userId === UserStore.getCurrentUser().id) {
      const platform = settings.store.platform ?? "desktop";
      return PLATFORM_INFO[platform as Platform] ?? null;
    }
    return null;
  },
});
