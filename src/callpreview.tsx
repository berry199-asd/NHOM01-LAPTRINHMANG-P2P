/**
 * Harness xem trước màn hình cuộc gọi (CHỈ để chụp ảnh kiểm thử giao diện).
 *
 * Không thuộc app thật. Đọc tham số truy vấn để dựng từng ngữ cảnh rồi gọi
 * `CallOverlay` với dữ liệu giả. Không đụng tới Home/api/WebRTC thật.
 *
 *   ?theme=dark|light  &kind=voice|video  &state=in-call|calling|connecting|ended|failed
 *   &dir=out|in  &people=2  &minimized=1  &net=good|weak|down  &avatar=0
 */
import "../src/index.css"
import { useEffect, useMemo, useState } from "react"
import { createRoot } from "react-dom/client"
import { CallOverlay } from "./components/CallOverlay"
import {
  colorForName,
  initialsOf,
  type CallNetHint,
  type CallPerson,
  type CallVisualState,
} from "./lib/callView"

const q = new URLSearchParams(location.search)
const theme = q.get("theme") === "light" ? "light" : "dark"
const kind = (q.get("kind") === "video" ? "video" : "voice") as "voice" | "video"
const state = (q.get("state") ?? "in-call") as CallVisualState
const dir = (q.get("dir") === "in" ? "in" : "out") as "out" | "in"
const people = Math.max(2, Number(q.get("people") ?? "2") || 2)
const minimized = q.get("minimized") === "1"
const net = (q.get("net") ?? "good") as CallNetHint
const withAvatar = q.get("avatar") !== "0"
/** Tên đối phương (thử tên rất dài để kiểm tra cắt "…"). */
const oppName = (q.get("name") || "").trim() || "Lê Thu Hà"
/** Ảnh lỗi: URL Tracker tuyệt đối không tồn tại → phải quy về cùng origin rồi rơi về chữ viết tắt. */
const badAvatar = q.get("badAvatar") === "1"

document.documentElement.classList.toggle("dark", theme === "dark")

function avatarFor(seed: string): string {
  const c = colorForName(seed)
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0' stop-color='${c}'/><stop offset='1' stop-color='#0f172a'/>` +
    `</linearGradient></defs>` +
    `<rect width='256' height='256' fill='url(#g)'/>` +
    `<circle cx='128' cy='98' r='48' fill='rgba(255,255,255,0.88)'/>` +
    `<rect x='50' y='156' width='156' height='96' rx='48' fill='rgba(255,255,255,0.88)'/>` +
    `</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

const NAMES = [
  "Trần Minh",
  "Lê Thu Hà",
  "Phạm Quốc Bảo",
  "Nguyễn An",
  "Vũ Khánh",
  "Đỗ Mai",
]

const roster: CallPerson[] = [
  {
    userId: 9,
    name: "Trần Minh",
    initials: "TM",
    avatar: withAvatar ? avatarFor("Trần Minh") : undefined,
    color: colorForName("Trần Minh"),
    isSelf: true,
  },
  {
    userId: 100,
    name: oppName,
    initials: initialsOf(oppName),
    avatar: badAvatar
      ? "http://localhost:9090/api/missing-avatar.png"
      : withAvatar
        ? avatarFor(oppName)
        : undefined,
    color: colorForName(oppName),
  },
  ...Array.from({ length: Math.max(0, people - 2) }, (_, i) => {
    const name = NAMES[(i + 1) % NAMES.length]
    return {
      userId: 101 + i,
      name,
      initials: initialsOf(name),
      avatar: withAvatar ? avatarFor(name) : undefined,
      color: colorForName(name),
    } satisfies CallPerson
  }),
]

function makeCanvasStream(label: string): MediaStream {
  const cv = document.createElement("canvas")
  cv.width = 640
  cv.height = 480
  const ctx = cv.getContext("2d")
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, 640, 480)
    g.addColorStop(0, "#1e3a8a")
    g.addColorStop(1, "#0f172a")
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 640, 480)
    ctx.fillStyle = "#93c5fd"
    ctx.font = "bold 56px sans-serif"
    ctx.fillText(label, 40, 250)
    ctx.fillStyle = "rgba(147,197,253,0.35)"
    ctx.fillRect(40, 300, 560, 8)
  }
  return cv.captureStream(30)
}

function Preview() {
  const [remoteStreams, setRemoteStreams] = useState<Record<number, MediaStream>>({})
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)

  useEffect(() => {
    if (kind !== "video") return
    const rs: Record<number, MediaStream> = {}
    for (let i = 1; i < people; i += 1) rs[100 + i - 1] = makeCanvasStream(NAMES[i])
    setRemoteStreams(rs)
    setLocalStream(makeCanvasStream("Bạn"))
  }, [])

  // ẢNH: CallOverlay tra theo userId trong thư viện người dùng (personDirectory);
  // harness không có server nên dữ liệu giả nằm trong `roster` (xem `usePersonAvatar`).

  const props = useMemo(
    () => ({
      call: {
        kind,
        dir,
        state,
        name: people > 2 ? "Nhóm Dự án Q4" : oppName,
        convId: 1,
        reason: state === "ended" ? "Cuộc gọi đã kết thúc" : undefined,
      },
      dur: state === "in-call" ? 3725 : 0,
      muted: q.get("muted") === "1",
      videoOff: q.get("videoOff") === "1",
      localStream,
      remoteStreams,
      roster,
      netHint: net,
      totalCount: people,
      minimized,
      onToggleMinimize: () => {},
      onHangUp: () => {},
      onAccept: () => {},
      onRetry: () => {},
      onToggleMute: () => {},
      onToggleVideo: () => {},
    }),
    [remoteStreams, localStream],
  )

  return <CallOverlay {...props} />
}

const el = document.getElementById("root")
if (el) createRoot(el).render(<Preview />)
