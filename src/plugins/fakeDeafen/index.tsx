/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Menu } from "@webpack/common";

const MediaEngineActions = findByPropsLazy("toggleSelfMute");
const NotificationSettingsStore = findByPropsLazy("getDisableAllSounds", "getState");

let updating = false;
async function update() {
  if (updating) return setTimeout(update, 125);
  updating = true;
  const state = NotificationSettingsStore.getState();
  const toDisable: string[] = [];
  if (!state.disabledSounds.includes("mute")) toDisable.push("mute");
  if (!state.disabledSounds.includes("unmute")) toDisable.push("unmute");

  state.disabledSounds.push(...toDisable);
  await new Promise(r => setTimeout(r, 50));
  await MediaEngineActions.toggleSelfMute();
  await new Promise(r => setTimeout(r, 100));
  await MediaEngineActions.toggleSelfMute();
  state.disabledSounds = state.disabledSounds.filter((i: string) => !toDisable.includes(i));
  updating = false;
}

export const settings = definePluginSettings({
  autoMute: {
    type: OptionType.BOOLEAN,
    description: "Automatically mute when deafened.",
    default: true
  }
});

const fakeVoiceState = {
  _selfMute: false,
  get selfMute() {
    try {
      if (!settings.store.autoMute) return this._selfMute;
      return this.selfDeaf || this._selfMute;
    } catch (e) {
      return this._selfMute;
    }
  },
  set selfMute(value) {
    this._selfMute = value;
  },
  selfDeaf: false,
  selfVideo: false
};

const StateKeys = ["selfDeaf", "selfMute", "selfVideo"];
export default definePlugin({
  name: "FakeMuteAndDeafen",
  description: "Fake mute and deafen yourself while still being able to hear and speak.",
  authors: [{ name: "8xu", id: 793880467270008832n }],
  settings,
  modifyVoiceState(e) {
    for (let i = 0; i < StateKeys.length; i++) {
      const stateKey = StateKeys[i];
      e[stateKey] = fakeVoiceState[stateKey] || e[stateKey];
    }
    return e;
  },
  contextMenus: {
    "audio-device-context"(children, d) {
      if (d.renderInputDevices) {
        children.push(<Menu.MenuSeparator />);
        children.push(
          <Menu.MenuCheckboxItem
            id="fake-mute"
            label="Fake Mute"
            checked={fakeVoiceState.selfMute}
            action={() => {
              fakeVoiceState.selfMute = !fakeVoiceState.selfMute;
              update();
            }}
          />
        );
      }

      if (d.renderOutputDevices) {
        children.push(<Menu.MenuSeparator />);
        children.push(
          <Menu.MenuCheckboxItem
            id="fake-deafen"
            label="Fake Deafen"
            checked={fakeVoiceState.selfDeaf}
            action={() => {
              fakeVoiceState.selfDeaf = !fakeVoiceState.selfDeaf;
              update();
            }}
          />
        );
      }
    },
    "video-device-context"(children) {
      children.push(<Menu.MenuSeparator />);
      children.push(
        <Menu.MenuCheckboxItem
          id="fake-video"
          label="Fake Camera"
          checked={fakeVoiceState.selfVideo}
          action={() => {
            fakeVoiceState.selfVideo = !fakeVoiceState.selfVideo;
            update();
          }}
        />
      );
    }
  },
  patches: [
    {
      find: "voiceServerPing(){",
      replacement: [
        {
          match: /voiceStateUpdate\((\w+)\){(.{0,10})guildId:/,
          replace: "voiceStateUpdate($1){$1=$self.modifyVoiceState($1);$2guildId:"
        }
      ]
    }
  ],
});
