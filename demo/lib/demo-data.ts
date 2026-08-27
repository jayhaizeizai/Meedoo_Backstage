export type PersonId = "team" | "mia" | "leo" | "ava" | "noah";
export type ViewId = PersonId | "leaderboard" | "videos";

export type Person = {
  name: string;
  zhName?: string;
  score: number | null;
  role: string;
  videos: number;
  color: string;
  kpis: string[];
  deltas: string[];
  mix: number[];
};

export const people: Record<PersonId, Person> = {
  team: { name: "Team overview", zhName: "团队总体", score: null, role: "", videos: 53, color: "#6757e8", kpis: ["3.84M", "8.42%", "8,426", "53"], deltas: ["+21.3%", "+12.6%", "+18.1%", "+7"], mix: [46, 34, 20] },
  mia: { name: "Mia Chen", score: 94, role: "Content Lead", videos: 18, color: "#6757e8", kpis: ["1.42M", "9.18%", "3,210", "18"], deltas: ["+24.1%", "+14.8%", "+20.5%", "+3"], mix: [51, 31, 18] },
  leo: { name: "Leo Wang", score: 87, role: "Creator", videos: 14, color: "#ff7a59", kpis: ["1.08M", "8.63%", "2,408", "14"], deltas: ["+18.6%", "+11.2%", "+16.1%", "+2"], mix: [43, 38, 19] },
  ava: { name: "Ava Lim", score: 82, role: "Creator", videos: 12, color: "#00a884", kpis: ["824K", "7.94%", "1,706", "12"], deltas: ["+16.2%", "+9.7%", "+14.4%", "+1"], mix: [39, 41, 20] },
  noah: { name: "Noah Tan", score: 76, role: "Editor", videos: 9, color: "#1689cf", kpis: ["516K", "6.88%", "1,102", "9"], deltas: ["+11.3%", "+7.5%", "+10.8%", "+1"], mix: [47, 26, 27] },
};

export const metrics = [
  { zh: "浏览 / 触达", en: "Views / Reach", weight: 6, total: "3.84M", ratio: 96, trend: "+21.3%" },
  { zh: "点赞", en: "Likes", weight: 3, total: "286K", ratio: 88, trend: "+12.6%" },
  { zh: "观看质量 / 留存", en: "Watch quality / Retention", weight: 17, total: "72.8%", ratio: 89, trend: "+6.4%" },
  { zh: "转发", en: "Reposts", weight: 22, total: "18.4K", ratio: 92, trend: "+14.2%" },
  { zh: "分享 / 发送", en: "Shares / Sends", weight: 18, total: "12.7K", ratio: 86, trend: "+9.8%" },
  { zh: "新增粉丝 / 订阅", en: "New followers", weight: 18, total: "8,426", ratio: 81, trend: "+18.1%" },
  { zh: "收藏", en: "Saves", weight: 10, total: "9,218", ratio: 78, trend: "+11.7%" },
  { zh: "评论", en: "Comments", weight: 6, total: "6,834", ratio: 84, trend: "+8.2%" },
] as const;

export const metricRanks: PersonId[][] = [
  ["mia", "leo", "ava", "noah"], ["leo", "mia", "noah", "ava"],
  ["ava", "mia", "leo", "noah"], ["mia", "leo", "ava", "noah"],
  ["leo", "mia", "ava", "noah"], ["mia", "ava", "leo", "noah"],
  ["leo", "ava", "mia", "noah"], ["ava", "leo", "mia", "noah"],
];

export const videos = [
  { title: "Five hooks that stop the scroll", owner: "Mia Chen", date: "Aug 25", duration: "0:18", color: "linear-gradient(140deg,#33305e,#e5a275)", stats: ["486K", "41.8K", "78.4%", "3,280", "2,146", "1,204", "1,862", "928"] },
  { title: "Behind the scenes: Studio day", owner: "Leo Wang", date: "Aug 24", duration: "0:27", color: "linear-gradient(140deg,#c9b5a8,#596779)", stats: ["392K", "32.6K", "74.1%", "2,740", "1,804", "982", "1,420", "816"] },
  { title: "3 edits that changed everything", owner: "Ava Lim", date: "Aug 21", duration: "0:22", color: "linear-gradient(140deg,#3cb29c,#edcb65)", stats: ["318K", "28.4K", "81.2%", "2,210", "1,568", "876", "1,106", "742"] },
  { title: "A day in our creative studio", owner: "Noah Tan", date: "Aug 19", duration: "0:31", color: "linear-gradient(140deg,#3575b8,#9a79d7)", stats: ["246K", "19.7K", "69.8%", "1,640", "1,092", "614", "886", "521"] },
] as const;

export function initials(name: string) {
  return name.split(" ").map((part) => part[0]).join("");
}
