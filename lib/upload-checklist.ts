export const uploadChecklistVersion = "2026-09-30-v1";
export const uploadChecklistItems = [
  {
    "id": "resonance",
    "zh": "内容是否让观众感觉到共鸣？",
    "en": "Does the content resonate with the audience?"
  },
  {
    "id": "story",
    "zh": "故事逻辑是否顺畅？",
    "en": "Does the story flow logically?"
  },
  {
    "id": "pace",
    "zh": "节奏是否紧凑？",
    "en": "Is the pacing tight?"
  },
  {
    "id": "ending",
    "zh": "结尾是否能帮助达到内容的目标？",
    "en": "Does the ending support the content goal?"
  },
  {
    "id": "cover-title",
    "zh": "封面与标题是否清楚、准确且有吸引力，并帮助达到内容目标？封面标题是否能够让每一个观众想到同一个问题？",
    "en": "Are the cover and title clear, accurate, compelling, and aligned with the content goal? Do they make viewers ask the same question?"
  },
  {
    "id": "visual-style",
    "zh": "整体画风是否统一？",
    "en": "Is the overall visual style consistent?"
  },
  {
    "id": "team-assets",
    "zh": "是否使用团队标准资产？",
    "en": "Are team-standard assets used?"
  },
  {
    "id": "appearance",
    "zh": "人物、宠物外观是否一致？",
    "en": "Are character and pet appearances consistent?"
  },
  {
    "id": "proportions",
    "zh": "宠物体型比例是否正确？",
    "en": "Are the pets’ body proportions correct?"
  },
  {
    "id": "romantic-future",
    "zh": "场景风格是否为浪漫未来？",
    "en": "Does the setting follow the Romantic Future style?"
  },
  {
    "id": "ai-creativity",
    "zh": "是否用了 AI 做出普通真实视频做不了的东西？",
    "en": "Does AI achieve something ordinary live-action video cannot?"
  },
  {
    "id": "cloud-voice",
    "zh": "Cloud 配音是否符合它的画像？",
    "en": "Does Cloud’s voice match its persona?"
  },
  {
    "id": "hashtags",
    "zh": "标签是否使用 SOP？",
    "en": "Do the hashtags follow the SOP?"
  },
  {
    "id": "pet-privacy",
    "zh": "是否隐藏宠物私密部位？",
    "en": "Are pets’ private parts concealed?"
  },
  {
    "id": "music",
    "zh": "背景音乐是否帮助达到内容的目标？",
    "en": "Does the background music support the content goal?"
  },
  {
    "id": "dialogue",
    "zh": "台词 / 同期声是否清晰？",
    "en": "Are dialogue and on-set audio clear?"
  }
] as const;
export function validUploadChecklist(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const v = value as { version?: unknown; checked?: unknown };
  return v.version === uploadChecklistVersion && Array.isArray(v.checked) && v.checked.length === uploadChecklistItems.length && new Set(v.checked).size === uploadChecklistItems.length && uploadChecklistItems.every(item => (v.checked as unknown[]).includes(item.id));
}
