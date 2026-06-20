import type { AppLocale } from "./types";

const dictionaries = {
  en: {
    adminSettings: "Admin settings",
    adminSubtitle: "AI configuration, knowledge base, audit and deployment controls.",
    agentConsole: "Agent console",
    signedInAs: "Signed in as",
    currentAccount: "Signed in as",
  },
  zh: {
    adminSettings: "后台设置",
    adminSubtitle: "AI 配置、知识库、审计和部署控制。",
    agentConsole: "客服工作台",
    signedInAs: "当前账号",
    currentAccount: "当前账号",
  },
} satisfies Record<AppLocale, Record<string, string>>;

export function adminText(locale: AppLocale | undefined) {
  return dictionaries[locale === "zh" ? "zh" : "en"];
}
