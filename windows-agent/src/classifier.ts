/**
 * Pulse Agent — app classifier (2026-05-29).
 *
 * Maps (appName, windowTitle) → AppCategory + a human reason. Runs on
 * the agent so the snapshot ships pre-categorised data — backend
 * doesn't need to redo classification on every read.
 *
 * Strategy:
 *   1. App-name patterns first (fast, deterministic, language-independent)
 *   2. Window-title patterns second — catches distractions hiding
 *      inside a browser process (chrome.exe → YouTube.com page title)
 *   3. Fall back to UNKNOWN
 *
 * The classifier is intentionally conservative — false positives
 * matter more than false negatives because misclassifying a personal
 * site as PRODUCTIVE erodes trust in the dashboard. UNKNOWN is fine
 * for unmapped apps; SUPER_ADMIN can see the app name and decide.
 */

import { isTamperTool } from './tamperPatterns';

export type AppCategory =
  | 'PRODUCTIVE'
  | 'COMMUNICATION'
  | 'ENTERTAINMENT'
  | 'PERSONAL'
  | 'UNKNOWN'
  | 'TAMPER';

export interface ClassificationResult {
  category: AppCategory;
  reason: string | null;
}

const RESULT_UNKNOWN: ClassificationResult = { category: 'UNKNOWN', reason: null };

// ─── App-name rules ──────────────────────────────────────────────────

interface NameRule {
  match: RegExp;
  category: Exclude<AppCategory, 'UNKNOWN'>;
  reason: string;
}

const APP_NAME_RULES: NameRule[] = [
  // ─── Productive — IDEs + editors ─────────────────────────────────
  { match: /^code\.exe$/i,                       category: 'PRODUCTIVE',    reason: 'Visual Studio Code' },
  { match: /^code - insiders\.exe$/i,            category: 'PRODUCTIVE',    reason: 'VS Code Insiders' },
  { match: /^cursor\.exe$/i,                     category: 'PRODUCTIVE',    reason: 'Cursor editor' },
  { match: /^windsurf\.exe$/i,                   category: 'PRODUCTIVE',    reason: 'Windsurf editor' },
  { match: /^zed\.exe$/i,                        category: 'PRODUCTIVE',    reason: 'Zed editor' },
  { match: /^devenv\.exe$/i,                     category: 'PRODUCTIVE',    reason: 'Visual Studio' },
  { match: /^(idea|pycharm|webstorm|goland|rider|clion|phpstorm|rubymine|appcode|datagrip)(64)?\.exe$/i, category: 'PRODUCTIVE', reason: 'JetBrains IDE' },
  { match: /^(sublime_text|nvim|neovim|emacs|vim|gvim)\.exe$/i, category: 'PRODUCTIVE', reason: 'Code editor' },
  { match: /^notepad\+\+\.exe$/i,                category: 'PRODUCTIVE',    reason: 'Notepad++' },
  { match: /^xcode\.exe$/i,                      category: 'PRODUCTIVE',    reason: 'Xcode' },
  { match: /^androidstudio64\.exe$/i,            category: 'PRODUCTIVE',    reason: 'Android Studio' },

  // ─── Productive — Office + writing + design ──────────────────────
  { match: /^(winword|excel|powerpnt|onenote|msaccess|visio|publisher)\.exe$/i, category: 'PRODUCTIVE', reason: 'Microsoft Office' },
  { match: /^(figma|adobe|photoshop|illustrator|premiere|aftereffects|indesign|xd|lightroom|sketchapp)\.exe$/i, category: 'PRODUCTIVE', reason: 'Design / creative tool' },
  { match: /^(blender|autocad|fusion 360|fusion360)\.exe$/i, category: 'PRODUCTIVE', reason: '3D / CAD tool' },

  // ─── Productive — Terminals + shells ─────────────────────────────
  { match: /^windowsterminal\.exe$/i,            category: 'PRODUCTIVE',    reason: 'Windows Terminal' },
  { match: /^(powershell|powershell_ise|pwsh|cmd|bash|wsl|ubuntu|debian|kali|opensuse)\.exe$/i, category: 'PRODUCTIVE', reason: 'Shell' },
  { match: /^(alacritty|wezterm-gui|wezterm|hyper|tabby|conemu|warp|kitty|mintty)\.exe$/i, category: 'PRODUCTIVE', reason: 'Modern terminal' },
  { match: /^(git-bash|gitbash|mingw32|mingw64)\.exe$/i, category: 'PRODUCTIVE', reason: 'Git Bash' },

  // ─── Productive — API + DB tools ─────────────────────────────────
  { match: /^postman\.exe$/i,                    category: 'PRODUCTIVE',    reason: 'Postman' },
  { match: /^insomnia\.exe$/i,                   category: 'PRODUCTIVE',    reason: 'Insomnia' },
  { match: /^bruno\.exe$/i,                      category: 'PRODUCTIVE',    reason: 'Bruno (API client)' },
  { match: /^(dbeaver|datagrip|tableplus|heidisql|pgadmin4|navicat|mongodbcompass)\.exe$/i, category: 'PRODUCTIVE', reason: 'Database tool' },
  { match: /^(redisdesktop|redisinsight|anothersqlmanager)\.exe$/i, category: 'PRODUCTIVE', reason: 'Redis tool' },

  // ─── Productive — Notes, docs, knowledge ─────────────────────────
  { match: /^obsidian\.exe$/i,                   category: 'PRODUCTIVE',    reason: 'Obsidian' },
  { match: /^(notion|notionsnap)\.exe$/i,        category: 'PRODUCTIVE',    reason: 'Notion' },
  { match: /^(linear|asana|trello|monday)\.exe$/i, category: 'PRODUCTIVE',  reason: 'Project management' },

  // ─── Productive — Source control + containers ────────────────────
  { match: /^(github desktop|githubdesktop|gitkraken|sourcetree|fork|smartgit)\.exe$/i, category: 'PRODUCTIVE', reason: 'Git client' },
  { match: /^(docker desktop|dockerdesktop|rancher desktop|podman|kubectl|lens)\.exe$/i, category: 'PRODUCTIVE', reason: 'Container / k8s tool' },

  // ─── Productive — AI / LLM desktop apps ──────────────────────────
  // (web variants caught by window-title rules below.)
  { match: /^(chatgpt|claude|copilot|gemini|perplexity|ollama)\.exe$/i, category: 'PRODUCTIVE', reason: 'AI / LLM desktop app' },

  // ─── Productive — Data science / notebooks ───────────────────────
  { match: /^(jupyter|jupyterlab|anaconda|spyder|rstudio)\.exe$/i, category: 'PRODUCTIVE', reason: 'Data science / notebook' },

  // ─── Communication ───────────────────────────────────────────────
  { match: /^slack\.exe$/i,                      category: 'COMMUNICATION', reason: 'Slack' },
  { match: /^(teams|ms-teams|msteams)\.exe$/i,   category: 'COMMUNICATION', reason: 'Microsoft Teams' },
  { match: /^zoom\.exe$/i,                       category: 'COMMUNICATION', reason: 'Zoom' },
  { match: /^outlook\.exe$/i,                    category: 'COMMUNICATION', reason: 'Outlook' },
  { match: /^thunderbird\.exe$/i,                category: 'COMMUNICATION', reason: 'Thunderbird email' },
  { match: /^(discord|discordcanary|discordptb)\.exe$/i, category: 'COMMUNICATION', reason: 'Discord' },
  { match: /^(skype|signal|telegram|whatsapp|whatsappdesktop|element)\.exe$/i, category: 'COMMUNICATION', reason: 'Messaging app' },
  { match: /^(googlemeet|meet|webex|gotomeeting|bluejeans)\.exe$/i, category: 'COMMUNICATION', reason: 'Video meeting' },
  { match: /^(loom|riverside|cleanfeed)\.exe$/i, category: 'COMMUNICATION', reason: 'Async video / podcast' },

  // ─── Entertainment — streaming, music, gaming ────────────────────
  // Indian streaming context: jiocinema/sonyliv/zee5/voot/mxplayer added
  // because the team is in India and these are the common distractions.
  { match: /^(netflix|disney\+|disneyplus|primevideo|hulu|max|hbomax|sonyliv|hotstar|jiocinema|zee5|voot|mxplayer|appletv)\.exe$/i, category: 'ENTERTAINMENT', reason: 'Streaming app' },
  { match: /^(spotify|amazonmusic|jiosaavn|gaana|wynk|youtubemusic)\.exe$/i, category: 'ENTERTAINMENT', reason: 'Music streaming' },
  { match: /^vlc\.exe$/i,                        category: 'ENTERTAINMENT', reason: 'VLC media player' },
  { match: /^(steam|epicgameslauncher|battle\.net|gog|ubisoftconnect|riotclient|origin|rockstargames)\.exe$/i, category: 'ENTERTAINMENT', reason: 'Gaming launcher' },
  { match: /^(twitch|obs64|obs32|streamlabs)\.exe$/i, category: 'ENTERTAINMENT', reason: 'Streaming / Twitch' },
  // Well-known games (extensible — add as you discover them in the breakdown drawer)
  { match: /^(minecraft|valorant|csgo|cs2|gta5|gtav|fortnite|leagueoflegends|dota2|apexlegends|pubg|amongus|roblox|bgmi)\.exe$/i, category: 'ENTERTAINMENT', reason: 'Game' },
];

// ─── Window-title rules (browser distractions) ───────────────────────
//
// Browsers all run as one process (chrome.exe etc.) but the actual
// active website is in the window title. These patterns catch the
// most common distractions hiding inside a browser tab.

interface TitleRule {
  match: RegExp;
  category: Exclude<AppCategory, 'UNKNOWN'>;
  reason: string;
}

const BROWSER_NAMES = /^(chrome|msedge|firefox|brave|opera|vivaldi|safari)\.exe$/i;

const WINDOW_TITLE_RULES: TitleRule[] = [
  // ─── Entertainment — streaming / video ───────────────────────────
  { match: /\b(youtube|youtu\.be)\b/i,                category: 'ENTERTAINMENT', reason: 'YouTube tab' },
  { match: /\bnetflix\.com\b/i,                       category: 'ENTERTAINMENT', reason: 'Netflix' },
  { match: /\bprimevideo\.com\b/i,                    category: 'ENTERTAINMENT', reason: 'Prime Video' },
  { match: /\b(disneyplus|disney\+|hotstar)\b/i,      category: 'ENTERTAINMENT', reason: 'Disney+ / Hotstar' },
  { match: /\b(hulu|max|hbomax|appletv)\.com\b/i,     category: 'ENTERTAINMENT', reason: 'US streaming' },
  // Indian streaming surfaces (team is in India — common distractions).
  { match: /\b(jiocinema|sonyliv|zee5|voot|mxplayer|sunnxt|altbalaji|erosnow)\b/i, category: 'ENTERTAINMENT', reason: 'Indian streaming' },
  { match: /\b(twitch\.tv|kick\.com)\b/i,             category: 'ENTERTAINMENT', reason: 'Live streaming' },
  { match: /\btiktok\.com\b/i,                        category: 'ENTERTAINMENT', reason: 'TikTok' },

  // ─── Personal — social, casual reading, personal email ───────────
  { match: /\b(facebook\.com|fb\.com)\b/i,            category: 'PERSONAL', reason: 'Facebook' },
  { match: /\b(twitter\.com|x\.com)\b/i,              category: 'PERSONAL', reason: 'X / Twitter' },
  { match: /\binstagram\.com\b/i,                     category: 'PERSONAL', reason: 'Instagram' },
  { match: /\bsnapchat\.com\b/i,                      category: 'PERSONAL', reason: 'Snapchat' },
  { match: /\bredditt?\.com\b/i,                      category: 'PERSONAL', reason: 'Reddit' },
  { match: /\bpinterest\.com\b/i,                     category: 'PERSONAL', reason: 'Pinterest' },
  { match: /\b(gmail|hotmail|yahoo|outlook\.live)\.com\b/i, category: 'PERSONAL', reason: 'Personal email' },
  { match: /\b(quora|medium|substack)\.com\b/i,       category: 'PERSONAL', reason: 'Casual reading' },
  // LinkedIn is intentionally PERSONAL — mostly social scrolling. If
  // recruiters need it counted productive, they can mark their device.
  { match: /\blinkedin\.com\b/i,                      category: 'PERSONAL', reason: 'LinkedIn (social)' },

  // ─── Productive — engineering + project management ───────────────
  { match: /\bgithub\.com\b/i,                        category: 'PRODUCTIVE', reason: 'GitHub' },
  { match: /\bgitlab\.com\b/i,                        category: 'PRODUCTIVE', reason: 'GitLab' },
  { match: /\bbitbucket\.org\b/i,                     category: 'PRODUCTIVE', reason: 'Bitbucket' },
  { match: /\b(jira|atlassian|confluence)\.com\b/i,   category: 'PRODUCTIVE', reason: 'Jira / Confluence' },
  { match: /\b(linear\.app|height\.app|asana\.com|monday\.com|clickup\.com|shortcut\.com|basecamp\.com)\b/i, category: 'PRODUCTIVE', reason: 'Project management' },
  { match: /\bsentry\.io\b/i,                         category: 'PRODUCTIVE', reason: 'Sentry / error monitoring' },
  { match: /\b(datadog|newrelic|honeycomb)\b/i,       category: 'PRODUCTIVE', reason: 'Observability tool' },
  { match: /\b(vercel|netlify|render|railway|heroku|fly\.io|cloudflare)\.com\b/i, category: 'PRODUCTIVE', reason: 'Deploy / hosting platform' },
  { match: /\b(aws|console\.aws|azure\.microsoft|console\.cloud\.google)\b/i, category: 'PRODUCTIVE', reason: 'Cloud console' },

  // ─── Productive — docs, knowledge bases, learning ────────────────
  { match: /\b(docs|drive|sheets|slides)\.google\.com\b/i, category: 'PRODUCTIVE', reason: 'Google Docs / Drive' },
  { match: /\bnotion\.so\b/i,                         category: 'PRODUCTIVE', reason: 'Notion' },
  { match: /\b(stackoverflow|stackexchange)\.com\b/i, category: 'PRODUCTIVE', reason: 'Stack Overflow' },
  { match: /\b(developer\.mozilla|w3schools|mdn|caniuse)\b/i, category: 'PRODUCTIVE', reason: 'Developer docs' },
  { match: /\b(docs?\.|docs\.[a-z]+)\b.*\b(react|vue|svelte|angular|nextjs|nuxt|typescript|python|django|flask|fastapi|rails|laravel|node|deno|bun|express)\b/i, category: 'PRODUCTIVE', reason: 'Framework docs' },
  // Design tools (web)
  { match: /\b(figma|miro|whimsical|excalidraw|tldraw|lucid)\.com\b/i, category: 'PRODUCTIVE', reason: 'Design tool' },
  // AI / LLM tools (web variants — desktop apps caught above)
  { match: /\b(chat\.openai|chatgpt|claude\.ai|gemini\.google|perplexity\.ai|copilot\.microsoft|cursor\.com|v0\.dev|bolt\.new|lovable\.dev|replit\.com|codesandbox\.io|stackblitz\.com)\b/i, category: 'PRODUCTIVE', reason: 'AI / LLM / online IDE' },
  { match: /\b(huggingface\.co|kaggle\.com|colab\.research\.google)\b/i, category: 'PRODUCTIVE', reason: 'ML / data science' },

  // ─── Communication — web meetings + web messaging ────────────────
  { match: /\b(meet\.google|teams\.microsoft|teams\.live|app\.slack|app\.zoom|whereby\.com|around\.co|gather\.town)\b/i, category: 'COMMUNICATION', reason: 'Web meeting' },
  { match: /\b(web\.whatsapp|web\.telegram|web\.discord|app\.discord|signal\.org)\b/i, category: 'COMMUNICATION', reason: 'Web messaging' },
];

// ─── Public API ──────────────────────────────────────────────────────

export function classifyApp(appName: string, windowTitle: string | null): ClassificationResult {
  const name = (appName ?? '').toLowerCase();

  // 1. Tamper tools win every other classification.
  if (isTamperTool(name)) {
    return { category: 'TAMPER', reason: 'Mouse-jiggler / keep-awake tool detected' };
  }

  // 2. App-name rules (exact / regex match on the executable).
  for (const rule of APP_NAME_RULES) {
    if (rule.match.test(name)) {
      // Browsers are special — they're sometimes used productively
      // and sometimes for entertainment. If it's a browser, we DON'T
      // short-circuit here; we fall through to window-title rules.
      if (BROWSER_NAMES.test(name)) break;
      return { category: rule.category, reason: rule.reason };
    }
  }

  // 3. Window-title rules (catches browser tabs).
  if (windowTitle) {
    for (const rule of WINDOW_TITLE_RULES) {
      if (rule.match.test(windowTitle)) {
        return { category: rule.category, reason: rule.reason };
      }
    }
  }

  // 4. Browser without a recognised tab → UNKNOWN (we don't assume
  //    "browser = productive" because that's where most distraction
  //    actually happens).
  if (BROWSER_NAMES.test(name)) {
    return { category: 'UNKNOWN', reason: 'Browser tab — site unknown' };
  }

  return RESULT_UNKNOWN;
}
