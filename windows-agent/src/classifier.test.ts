/**
 * Pulse Agent — classifier unit tests.
 *
 * Pinning the (appName, windowTitle) → category mapping for every rule
 * matters more than for most code in the agent: the entire DEEP_WORK
 * sub-score derives from `productiveSeconds` which is the sum of
 * `foregroundSeconds` for app buckets whose `category === 'PRODUCTIVE'`.
 * A typo in a regex silently inverts an employee's score.
 *
 * These tests also catch the "Slack desktop is COMMUNICATION but
 * app.slack.com would be PRODUCTIVE if we forgot the rule" class of
 * bugs by exercising the browser-fallthrough path explicitly.
 */

import { describe, it, expect } from 'vitest';
import { classifyApp } from './classifier';

describe('classifyApp — tamper tools win every other rule', () => {
  it.each([
    'caffeine.exe',
    'mousejiggler.exe',
    'moveit.exe',
    'keepalive.exe',
    'awakemate.exe',
    'autohotkey.exe',
    'jiggler.exe',
    'amphetamine.exe',
    'stayawake.exe',
  ])('%s → TAMPER', (name) => {
    const r = classifyApp(name, null);
    expect(r.category).toBe('TAMPER');
    expect(r.reason).toMatch(/tamper|keep-awake/i);
  });

  it('uppercase / casing variants still hit the rule', () => {
    expect(classifyApp('Caffeine.EXE', null).category).toBe('TAMPER');
    expect(classifyApp('MouseJiggler.exe', null).category).toBe('TAMPER');
  });
});

describe('classifyApp — productive app names', () => {
  it.each([
    ['code.exe', /Code/i],
    ['Code - Insiders.exe', /Insiders/i],
    ['cursor.exe', /Cursor/i],
    ['windsurf.exe', /Windsurf/i],
    ['idea64.exe', /JetBrains/i],
    ['pycharm64.exe', /JetBrains/i],
    ['rubymine64.exe', /JetBrains/i],
    ['devenv.exe', /Visual Studio/i],
    ['nvim.exe', /editor/i],
    ['windowsterminal.exe', /Terminal/i],
    ['pwsh.exe', /Shell/i],
    ['bash.exe', /Shell/i],
    ['alacritty.exe', /terminal/i],
    ['wezterm-gui.exe', /terminal/i],
    ['warp.exe', /terminal/i],
    ['postman.exe', /Postman/i],
    ['bruno.exe', /Bruno/i],
    ['dbeaver.exe', /Database/i],
    ['mongodbcompass.exe', /Database/i],
    ['obsidian.exe', /Obsidian/i],
    ['notion.exe', /Notion/i],
    ['linear.exe', /Project management/i],
    ['github desktop.exe', /Git client/i],
    ['gitkraken.exe', /Git client/i],
    ['docker desktop.exe', /Container/i],
    ['chatgpt.exe', /AI/i],
    ['claude.exe', /AI/i],
    ['ollama.exe', /AI/i],
    ['jupyter.exe', /data science|notebook/i],
    ['rstudio.exe', /data science|notebook/i],
    ['androidstudio64.exe', /Android Studio/i],
    ['blender.exe', /3D|CAD/i],
    ['figma.exe', /Design/i],
  ])('%s → PRODUCTIVE (%s)', (name, reasonPattern) => {
    const r = classifyApp(name, null);
    expect(r.category).toBe('PRODUCTIVE');
    expect(r.reason).toMatch(reasonPattern);
  });
});

describe('classifyApp — communication app names', () => {
  it.each([
    ['slack.exe', 'Slack'],
    ['teams.exe', 'Microsoft Teams'],
    ['msteams.exe', 'Microsoft Teams'],
    ['zoom.exe', 'Zoom'],
    ['outlook.exe', 'Outlook'],
    ['thunderbird.exe', 'Thunderbird email'],
    ['discord.exe', 'Discord'],
    ['whatsapp.exe', 'Messaging app'],
    ['telegram.exe', 'Messaging app'],
    ['element.exe', 'Messaging app'],
    ['webex.exe', 'Video meeting'],
    ['loom.exe', 'Async video / podcast'],
  ])('%s → COMMUNICATION (%s)', (name, reason) => {
    const r = classifyApp(name, null);
    expect(r.category).toBe('COMMUNICATION');
    expect(r.reason).toBe(reason);
  });
});

describe('classifyApp — entertainment / personal app names', () => {
  it.each([
    ['netflix.exe', 'ENTERTAINMENT'],
    ['hotstar.exe', 'ENTERTAINMENT'],
    ['jiocinema.exe', 'ENTERTAINMENT'],
    ['sonyliv.exe', 'ENTERTAINMENT'],
    ['zee5.exe', 'ENTERTAINMENT'],
    ['voot.exe', 'ENTERTAINMENT'],
    ['spotify.exe', 'ENTERTAINMENT'],
    ['jiosaavn.exe', 'ENTERTAINMENT'],
    ['vlc.exe', 'ENTERTAINMENT'],
    ['steam.exe', 'ENTERTAINMENT'],
    ['epicgameslauncher.exe', 'ENTERTAINMENT'],
    ['valorant.exe', 'ENTERTAINMENT'],
    ['bgmi.exe', 'ENTERTAINMENT'],
  ])('%s → %s', (name, expected) => {
    expect(classifyApp(name, null).category).toBe(expected);
  });
});

describe('classifyApp — browser fall-through to window-title rules', () => {
  it('chrome with no title → UNKNOWN', () => {
    expect(classifyApp('chrome.exe', null).category).toBe('UNKNOWN');
  });

  it('chrome with an unrecognised title → UNKNOWN', () => {
    expect(classifyApp('chrome.exe', 'Some random page — Chrome').category).toBe('UNKNOWN');
  });

  it.each([
    ['github.com/exargen-ai/repo · Chrome', 'PRODUCTIVE', /GitHub/i],
    ['linear.app/exargen — Chrome', 'PRODUCTIVE', /Project management/i],
    ['docs.google.com/document/d/abc — Chrome', 'PRODUCTIVE', /Google Docs/i],
    ['stackoverflow.com/questions/123 — Chrome', 'PRODUCTIVE', /Stack Overflow/i],
    ['chat.openai.com — Chrome', 'PRODUCTIVE', /AI/i],
    ['claude.ai/chat — Chrome', 'PRODUCTIVE', /AI/i],
    ['perplexity.ai — Chrome', 'PRODUCTIVE', /AI/i],
    ['v0.dev/exargen — Chrome', 'PRODUCTIVE', /AI/i],
    ['vercel.com/dashboard — Chrome', 'PRODUCTIVE', /Deploy/i],
    ['console.aws.amazon.com — Chrome', 'PRODUCTIVE', /Cloud console/i],
    ['sentry.io/exargen/issues — Chrome', 'PRODUCTIVE', /Sentry/i],
    ['kaggle.com/competitions — Chrome', 'PRODUCTIVE', /ML/i],
    ['meet.google.com/abc-defg-hij — Chrome', 'COMMUNICATION', /Web meeting/i],
    ['web.whatsapp.com — Chrome', 'COMMUNICATION', /Web messaging/i],
    ['youtube.com/watch?v=… — Chrome', 'ENTERTAINMENT', /YouTube/i],
    ['netflix.com/browse — Chrome', 'ENTERTAINMENT', /Netflix/i],
    ['jiocinema.com — Chrome', 'ENTERTAINMENT', /Indian streaming/i],
    ['twitch.tv/somestreamer — Chrome', 'ENTERTAINMENT', /Live streaming/i],
    ['tiktok.com — Chrome', 'ENTERTAINMENT', /TikTok/i],
    ['facebook.com — Chrome', 'PERSONAL', /Facebook/i],
    ['x.com/elonmusk — Chrome', 'PERSONAL', /X.*Twitter/i],
    ['reddit.com/r/programming — Chrome', 'PERSONAL', /Reddit/i],
    ['linkedin.com/feed — Chrome', 'PERSONAL', /LinkedIn/i],
    ['gmail.com/inbox — Chrome', 'PERSONAL', /Personal email/i],
    ['medium.com/some-article — Chrome', 'PERSONAL', /reading/i],
  ])('%s → %s (%s)', (title, expected, reasonPattern) => {
    const r = classifyApp('chrome.exe', title);
    expect(r.category).toBe(expected);
    expect(r.reason).toMatch(reasonPattern);
  });

  it.each(['msedge.exe', 'firefox.exe', 'brave.exe', 'opera.exe', 'vivaldi.exe', 'safari.exe'])(
    '%s with github.com title → PRODUCTIVE',
    (browser) => {
      expect(classifyApp(browser, 'exargen-ai/repo - github.com').category).toBe('PRODUCTIVE');
    },
  );
});

describe('classifyApp — unmapped apps fall through to UNKNOWN', () => {
  it('random .exe → UNKNOWN', () => {
    expect(classifyApp('someweirdapp.exe', null).category).toBe('UNKNOWN');
    expect(classifyApp('someweirdapp.exe', null).reason).toBeNull();
  });

  it('empty appName → UNKNOWN', () => {
    expect(classifyApp('', null).category).toBe('UNKNOWN');
  });
});

describe('classifyApp — tamper rule precedence over everything else', () => {
  it('caffeine.exe with a productive-looking title still wins as TAMPER', () => {
    expect(classifyApp('caffeine.exe', 'github.com/foo — Chrome').category).toBe('TAMPER');
  });
});
