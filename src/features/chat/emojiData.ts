export const QUICK_REACTS = ["👍", "❤️", "😂", "😮", "😢", "😡"]

export const RECENT_EMOJI_KEY = "workchat_recent_emojis"

export type ReactionSummary = { emoji: string; count: number }[]

export const summarizeReactions = (
  reactions: { emoji: string }[] | undefined,
): ReactionSummary => {
  if (!reactions || reactions.length === 0) return []
  const counts = new Map<string, number>()
  for (const r of reactions) counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1)
  return [...counts.entries()]
    .map(([emoji, count]) => ({ emoji, count }))
    .sort((a, b) => b.count - a.count)
}

export const THEME_COLORS: { color: string; icon: string }[] = [
  { color: "#1a1a1a", icon: "👍" },
  { color: "#2872fa", icon: "👍" },
  { color: "#7a3ff2", icon: "👍" },
  { color: "#e13b5f", icon: "❤️" },
  { color: "#0a9d78", icon: "👍" },
  { color: "#d97706", icon: "👍" },
  { color: "#dc2626", icon: "❤️" },
  { color: "#0ea5e9", icon: "👍" },
]

export const themeIcon = (conv: { theme?: string }) =>
  THEME_COLORS.find((t) => t.color === conv.theme)?.icon ?? "👍"

export const EMOJI_CHOICE = [
  "👍",
  "❤️",
  "😂",
  "😮",
  "😢",
  "😡",
  "🎉",
  "🔥",
  "👏",
  "🤔",
  "💯",
  "🙏",
]

export const EMOJI_DICT: [string, string[]][] = [
  ["😀", ["cười", "mặt", "smile", "happy", "grinning"]],
  ["😁", ["cười", "răng", "haha", "joy"]],
  ["😂", ["cười", "lăn lộn", "tears", "joy", "rofl"]],
  ["🤣", ["cười sặc", "rofl", "rolling"]],
  ["😊", ["cười", "mỉm", "smile", "blush"]],
  ["😍", ["yêu", "tim", "hearts", "love"]],
  ["😘", ["hôn", "kiss", "thơm"]],
  ["😋", ["ngon", "yummy", "liếm"]],
  ["😜", ["nghịch", "wink", "tongue"]],
  ["🤪", ["điên", "crazy"]],
  ["😎", ["kính", "ngầu", "cool", "sunglasses"]],
  ["🤩", ["sao", "star", "excited"]],
  ["🥳", ["tiệc", "party", "birthday"]],
  ["😮", ["ngạc nhiên", "wow", "surprised"]],
  ["😱", ["sốc", "sợ", "shock", "scream"]],
  ["😴", ["ngủ", "sleep", "tired"]],
  ["🥺", ["bùn", "pleading", "xin"]],
  ["😢", ["khóc", "bùn", "tears", "cry"]],
  ["😭", ["khóc lớn", "sob", "crying"]],
  ["😡", ["giận", "angry", "tức"]],
  ["😠", ["tức", "mad"]],
  ["🤯", ["nổ não", "mind blown", "mindblown"]],
  ["🤔", ["suy nghĩ", "thinking", "hmm"]],
  ["🙄", ["lắc mắt", "eyeball", "facepalm"]],
  ["🤨", ["nghi ngờ", "suspicious"]],
  ["😅", ["gãi đầu", "sweat", "due"]],
  ["🥰", ["yêu", "love", "hearts"]],
  ["😇", ["thiên thần", "angel", "ngoan"]],
  ["🤗", ["ôm", "hug"]],
  ["🙃", ["lộn ngược", "upside"]],
  ["😬", ["kiềm nén", "grimace", "awkward"]],
  ["😷", ["khẩu trang", "mask", "bệnh"]],
  ["🤒", ["sốt", "fever", "bệnh"]],
  ["🤮", ["ói", "puke", "vomit"]],
  ["😵", ["chóng mặt", "dizzy"]],
  ["🤤", ["chảy nước miếng", "drool"]],
  ["🥱", ["ngáp", "yawn"]],
  ["👋", ["vẫy tay", "wave", "chào"]],
  ["🤚", ["giơ tay", "hand", "dừng"]],
  ["✋", ["bàn tay", "hand", "stop"]],
  ["🖐️", ["bàn tay", "hand"]],
  ["👌", ["ok", "chuẩn", "perfect"]],
  ["🤌", ["pín", "pinched", "chậc"]],
  ["🤞", ["may mắn", "crossed", "fingers"]],
  ["✌️", ["hoà bình", "peace", "victory"]],
  ["🤟", ["i love you", "rock"]],
  ["🤘", ["rock", "biểu tượng"]],
  ["👍", ["thích", "like", "tốt", "thumb", "up"]],
  ["👎", ["không thích", "dislike", "down"]],
  ["👊", ["nắm đấm", "fist"]],
  ["✊", ["đấu tranh", "solidarity"]],
  ["🙏", ["cảm ơn", "thank", "chắp tay", "pray"]],
]
