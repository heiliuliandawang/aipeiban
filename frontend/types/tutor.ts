export interface TutorMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  topic?: string;
}

export interface TutorWorkspace {
  messages: TutorMessage[];
  currentTopic: string;
}

export const TUTOR_WELCOME_CONTENT =
  "你好！我是你的专属辅导助手 🧑‍🏫\n\n遇到不懂的知识点，直接问我吧！我会根据你的学习画像，用最适合你的方式来解释。\n\n**你可以：**\n- 选择正在学习的主题，系统会推荐常见问题\n- 直接输入任何问题\n- 针对我的回答继续追问";

export function createTutorWelcomeMessage(): TutorMessage {
  return {
    role: "assistant",
    content: TUTOR_WELCOME_CONTENT,
    timestamp: new Date(),
  };
}

export function createEmptyTutorWorkspace(): TutorWorkspace {
  return {
    messages: [createTutorWelcomeMessage()],
    currentTopic: "",
  };
}

export interface TutorHistoryResponse {
  messages: Array<{ role: "user" | "assistant"; content: string; topic?: string }>;
}
