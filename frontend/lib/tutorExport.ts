import { TUTOR_WELCOME_CONTENT, type TutorMessage } from "@/types";

/** 将辅导对话导出为 Markdown 文本 */
export function formatTutorTranscript(
  messages: TutorMessage[],
  currentTopic: string
): string {
  const lines: string[] = [
    "# 智能辅导记录",
    "",
    currentTopic ? `**学习主题：** ${currentTopic}` : "**学习主题：** 未指定",
    `**导出时间：** ${new Date().toLocaleString("zh-CN")}`,
    "",
    "---",
    "",
  ];

  for (const msg of messages) {
    if (msg.role === "assistant" && msg.content === TUTOR_WELCOME_CONTENT) {
      continue;
    }
    const time = msg.timestamp instanceof Date
      ? msg.timestamp.toLocaleString("zh-CN")
      : new Date(msg.timestamp).toLocaleString("zh-CN");
    const speaker = msg.role === "user" ? "我" : "辅导助手";
    lines.push(`## ${speaker} · ${time}`);
    if (msg.topic) {
      lines.push(`> 主题：${msg.topic}`);
    }
    lines.push("");
    lines.push(msg.content.trim());
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}

export function downloadTutorTranscript(
  messages: TutorMessage[],
  currentTopic: string,
  sessionId: string
) {
  const markdown = formatTutorTranscript(messages, currentTopic);
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `tutor-${sessionId.slice(0, 8) || "session"}-${date}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
